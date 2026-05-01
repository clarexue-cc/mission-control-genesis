import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

const hermesTasksMock = vi.hoisted(() => ({
  getHermesTasks: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/command', () => ({
  runCommand: vi.fn(),
}))

vi.mock('@/lib/hermes-tasks', () => ({
  getHermesTasks: hermesTasksMock.getHermesTasks,
}))

describe('GET /api/harness/hermes', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''
  let vaultRoot = ''

  function user(role: 'admin' | 'operator' | 'viewer') {
    return {
      id: 1,
      username: role,
      display_name: role,
      role,
      workspace_id: 1,
      tenant_id: 1,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
    }
  }

  async function loadGet() {
    vi.resetModules()
    const route = await import('@/app/api/harness/hermes/route')
    return route.GET
  }

  function request(cookie?: string) {
    return new NextRequest('http://localhost/api/harness/hermes', {
      headers: cookie ? { cookie } : {},
    })
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mc-hermes-route-'))
    vaultRoot = path.join(tempDir, 'openclaw-vault')
    await mkdir(path.join(vaultRoot, 'Agent-Shared'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'Agent-Main'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'Agent-Shared/hermes-log.md'), '# Hermes Guard Log\n', 'utf8')
    await writeFile(path.join(vaultRoot, 'Agent-Main/working-context.md'), '# fresh\n', 'utf8')

    process.env = {
      ...originalEnv,
      MC_OBSIDIAN_VAULT_ROOT: vaultRoot,
      HERMES_DAEMON_PID_FILE: path.join(vaultRoot, 'Agent-Shared/hermes-daemon.pid'),
      HERMES_LOG_FILE: path.join(vaultRoot, 'Agent-Shared/hermes-log.md'),
    }
    authMock.requireRole.mockReset()
    hermesTasksMock.getHermesTasks.mockReset()
    hermesTasksMock.getHermesTasks.mockReturnValue({ cronJobs: [] })
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('allows admin users to read Hermes state', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    const GET = await loadGet()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'operator')
    expect(body.daemon_running).toBe(false)
    expect(body.targets[0].health).toBe('fresh')
    expect(body.cron).toMatchObject({
      total_jobs: 0,
      enabled_jobs: 0,
      openclaw_monitoring: false,
      heartbeat_monitoring: false,
    })
    expect(body.cron.evidence).toContain('No Hermes cron jobs found')
  })

  it('reports Hermes cron evidence when OpenClaw heartbeat monitoring jobs exist', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    hermesTasksMock.getHermesTasks.mockReturnValue({
      cronJobs: [
        {
          id: 'openclaw-heartbeat',
          prompt: 'Check OpenClaw tenant heartbeat and working-context freshness',
          schedule: '*/15 * * * *',
          enabled: true,
          lastRunAt: '2026-05-01T10:00:00Z',
          lastOutput: 'ok',
          createdAt: '2026-05-01T09:00:00Z',
          runCount: 3,
        },
      ],
    })
    const GET = await loadGet()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(hermesTasksMock.getHermesTasks).toHaveBeenCalledWith(true)
    expect(body.cron).toMatchObject({
      total_jobs: 1,
      enabled_jobs: 1,
      openclaw_monitoring: true,
      heartbeat_monitoring: true,
      last_run_at: '2026-05-01T10:00:00Z',
    })
    expect(body.cron.jobs[0]).toMatchObject({
      id: 'openclaw-heartbeat',
      schedule: '*/15 * * * *',
      enabled: true,
      runCount: 3,
    })
  })

  it('allows operator users to read Hermes state', async () => {
    authMock.requireRole.mockReturnValue({ user: user('operator') })
    const GET = await loadGet()

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'operator')
  })

  it('blocks customer view role even when authenticated', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    const GET = await loadGet()

    const response = await GET(request('mc-view-role=customer'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Customer role cannot access Hermes internals')
  })

  it('returns 401 when requireRole cannot authenticate the request', async () => {
    authMock.requireRole.mockReturnValue({ error: 'Authentication required', status: 401 })
    const GET = await loadGet()

    const response = await GET(request())

    expect(response.status).toBe(401)
  })
})
