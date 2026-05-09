import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireRole = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
}

async function writeText(filePath: string, value: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value, 'utf8')
}

describe('harness phase 3-6 routes', () => {
  let phase0Dir: string
  const previousPhase0Dir = process.env.MC_HARNESS_PHASE0_DIR

  beforeEach(async () => {
    vi.resetModules()
    requireRole.mockReturnValue({ user: { id: 1, username: 'admin', role: 'admin', workspace_id: 1 } })

    phase0Dir = await mkdtemp(path.join(os.tmpdir(), 'mc-harness-phase3-6-'))
    process.env.MC_HARNESS_PHASE0_DIR = phase0Dir

    const tenantDir = path.join(phase0Dir, 'tenants', 'acme')
    await writeJson(path.join(tenantDir, 'tenant', 'vars.json'), {
      tenant_name: 'ACME Intelligence',
      daily_budget_usd: 25,
      telegram_bot_token: 'configured',
    })
    await writeJson(path.join(tenantDir, 'config', 'boundary-rules.json'), {
      forbidden_patterns: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }, { id: 'f5' }],
      drift_patterns: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }],
    })
    await writeJson(path.join(tenantDir, 'deploy-status.json'), { status: 'success', mode: 'mock' })
    await writeText(path.join(tenantDir, 'AGENTS.base.md'), '# AGENTS\n\nready')
    await writeText(path.join(tenantDir, 'vault', 'confirmation-cc.md'), '# Confirmation\n\nApproved by Clare.')
    await writeText(path.join(tenantDir, 'vault', 'intake-analysis.md'), '# Analysis\n\n## UAT 标准\n- Evidence visible\n')
    await writeText(path.join(tenantDir, 'vault', 'Agent-Main', 'SOUL.md'), '# SOUL\n\nSkill: source-evidence-deduper\n')
    await writeText(path.join(tenantDir, 'tests', 'golden-10-cc.md'), '# Golden\n\n1. pass case\n')
    await writeText(path.join(tenantDir, 'tests', 'adversarial-20-cc.md'), '# Adversarial\n\n1. block case\n')
    await writeText(path.join(tenantDir, 'tests', 'cross-session-3-cc.md'), '# Cross session\n\n1. memory case\n')

    await writeJson(path.join(phase0Dir, 'templates', 'delivery-checklist', 'ready-to-ship-rules.json'), {
      version: '2.0',
      final_rule: { summary: 'all critical and high checks green' },
      checks: [
        { check_id: 'RTS-01', check_name: 'Runtime health', severity: 'critical', category: 'runtime', expected: 'healthy', fail_hint: 'restart' },
        { check_id: 'RTS-02', check_name: 'Budget configured', severity: 'critical', category: 'config', expected: 'budget', fail_hint: 'set budget' },
      ],
    })
  })

  afterEach(async () => {
    process.env.MC_HARNESS_PHASE0_DIR = previousPhase0Dir
    await rm(phase0Dir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('returns gate testing evidence for a tenant', async () => {
    const { GET } = await import('@/app/api/harness/gates/route')
    const response = await GET(new NextRequest('http://localhost/api/harness/gates?tenant=acme'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.tenant.tenant_id).toBe('acme')
    expect(body.phase.id).toBe('P10')
    expect(body.summary.total_checks).toBeGreaterThanOrEqual(5)
    expect(body.checks.map((check: { id: string }) => check.id)).toContain('gate-golden')
    expect(body.checks.find((check: { id: string }) => check.id === 'gate-boundary').status).toBe('pass')
  })

  it('returns pre-launch ready-to-ship checks for a tenant', async () => {
    const { GET } = await import('@/app/api/harness/pre-launch/route')
    const response = await GET(new NextRequest('http://localhost/api/harness/pre-launch?tenant=acme'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.phase.id).toBe('P12')
    expect(body.rules.version).toBe('2.0')
    expect(body.readiness.status).toBe('ready')
    expect(body.checks.map((check: { id: string }) => check.id)).toContain('RTS-01')
  })

  it('returns delivery report sections for a tenant', async () => {
    const { GET } = await import('@/app/api/harness/delivery-report/route')
    const response = await GET(new NextRequest('http://localhost/api/harness/delivery-report?tenant=acme'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.phase.id).toBe('P16')
    expect(body.report.status).toBe('ready')
    expect(body.sections.map((section: { id: string }) => section.id)).toEqual([
      'intake',
      'build',
      'gates',
      'pre_launch',
      'uat',
      'handoff',
    ])
  })
})
