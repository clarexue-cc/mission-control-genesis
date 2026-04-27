import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireRoleMock = vi.hoisted(() => vi.fn())
const configMock = vi.hoisted(() => ({ logsDir: '' }))

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/config', () => ({ config: configMock }))
vi.mock('@/lib/rate-limit', () => ({
  readLimiter: vi.fn(() => null),
  mutationLimiter: vi.fn(() => null),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { GET } from '../route'

const adminUser = {
  id: 1,
  username: 'admin',
  display_name: 'Admin',
  role: 'admin',
  workspace_id: 1,
  tenant_id: 1,
  created_at: 0,
  updated_at: 0,
  last_login_at: null,
}

function request(query = '') {
  return new NextRequest(`http://localhost/api/logs${query}`)
}

async function writeHookEvents(root: string, tenant: string, lines: string[]) {
  const dir = path.join(root, 'phase0', 'tenants', tenant, 'state')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'hook-events.jsonl'), `${lines.join('\n')}\n`, 'utf8')
}

async function readJson(response: Response) {
  return await response.json() as { logs?: any[]; sources?: string[]; error?: string }
}

describe('/api/logs hook-events source', () => {
  let tempRoot: string
  let logsDir: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-hook-logs-'))
    logsDir = path.join(tempRoot, 'openclaw-logs')
    await mkdir(logsDir, { recursive: true })
    await mkdir(path.join(tempRoot, 'phase0', 'tenants'), { recursive: true })
    process.env.MC_HARNESS_ROOT = tempRoot
    configMock.logsDir = logsDir
    requireRoleMock.mockReset()
    requireRoleMock.mockReturnValue({ user: adminUser })
  })

  afterEach(async () => {
    delete process.env.MC_HARNESS_ROOT
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('parses hook-events jsonl and skips malformed lines', async () => {
    await writeHookEvents(tempRoot, 'tenant-tg-001', [
      'not-json',
      JSON.stringify({
        timestamp: '2026-04-24T02:37:45.136Z',
        tenant: 'tenant-tg-001',
        agent: 'Web3 research',
        content_preview: 'GH_BOUNDARY_SENTINEL_20260424',
        rule_matched: 'SNT-20260424',
        action: 'block',
        severity: 'critical',
        session_id: 'agent:main:telegram:default',
      }),
    ])

    const response = await GET(request('?tenant=tenant-tg-001&search=SNT-20260424'))
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body.logs).toHaveLength(1)
    expect(body.logs?.[0]).toMatchObject({
      source: 'hook-event',
      rule_id: 'SNT-20260424',
      matched_rule: 'SNT-20260424',
      severity: 'critical',
      action: 'block',
      tenant: 'tenant-tg-001',
    })
    expect(body.logs?.[0].message).toContain('boundary_violation')
  })

  it('merges hook-events with existing logs in reverse chronological order', async () => {
    await writeFile(
      path.join(logsDir, 'app.log'),
      [
        JSON.stringify({ timestamp: 1000, level: 'info', source: 'app', message: 'old app log' }),
        JSON.stringify({ timestamp: 3000, level: 'info', source: 'app', message: 'new app log' }),
      ].join('\n'),
      'utf8',
    )
    await writeHookEvents(tempRoot, 'tenant-a', [
      JSON.stringify({
        timestamp: 2000,
        tenant: 'tenant-a',
        rule_matched: 'SNT-MID',
        action: 'block',
        severity: 'critical',
      }),
    ])

    const response = await GET(request('?tenant=tenant-a'))
    const body = await readJson(response)

    expect(body.logs?.map(log => log.timestamp)).toEqual([3000, 2000, 1000])
    expect(body.logs?.map(log => log.source)).toEqual(['app', 'hook-event', 'app'])
  })

  it('filters hook-events by rule_id, matched_rule, severity, and SNT prefix', async () => {
    await writeHookEvents(tempRoot, 'tenant-a', [
      JSON.stringify({
        timestamp: 2000,
        tenant: 'tenant-a',
        rule_matched: 'SNT-SEARCH',
        action: 'block',
        severity: 'critical',
      }),
    ])

    for (const search of ['rule_id', 'matched_rule', 'critical', 'SNT-SEARCH']) {
      const response = await GET(request(`?tenant=tenant-a&source=hook-event&search=${encodeURIComponent(search)}`))
      const body = await readJson(response)
      expect(body.logs).toHaveLength(1)
      expect(body.logs?.[0].rule_id).toBe('SNT-SEARCH')
    }
  })

  it('requires admin role for GET /api/logs', async () => {
    requireRoleMock.mockReturnValueOnce({ error: 'Requires admin role or higher', status: 403 })
    const denied = await GET(request())

    expect(denied.status).toBe(403)
    expect(requireRoleMock).toHaveBeenCalledWith(expect.any(NextRequest), 'admin')

    requireRoleMock.mockReturnValueOnce({ user: adminUser })
    const allowed = await GET(request())
    expect(allowed.status).toBe(200)
  })

  it('returns an empty array when hook-events.jsonl is missing', async () => {
    const response = await GET(request('?tenant=tenant-empty&source=hook-event'))
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body.logs).toEqual([])
  })

  it('keeps hook-events isolated by tenant query', async () => {
    await writeHookEvents(tempRoot, 'tenant-a', [
      JSON.stringify({ timestamp: 2000, tenant: 'tenant-a', rule_matched: 'SNT-A', action: 'block', severity: 'critical' }),
    ])
    await writeHookEvents(tempRoot, 'tenant-b', [
      JSON.stringify({ timestamp: 3000, tenant: 'tenant-b', rule_matched: 'SNT-B', action: 'block', severity: 'critical' }),
    ])

    const response = await GET(request('?tenant=tenant-a&source=hook-event'))
    const body = await readJson(response)

    expect(body.logs).toHaveLength(1)
    expect(body.logs?.[0].rule_id).toBe('SNT-A')
    expect(JSON.stringify(body.logs)).not.toContain('SNT-B')
  })
})
