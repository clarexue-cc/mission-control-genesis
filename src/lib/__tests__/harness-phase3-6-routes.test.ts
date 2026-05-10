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
      api_key: 'configured',
    })
    await writeJson(path.join(tenantDir, 'config', 'gateway.json'), {
      endpoint: 'http://localhost:4317',
      mode: 'mock',
    })
    await writeJson(path.join(tenantDir, 'config', 'boundary-finalized.json'), {
      finalized: true,
    })
    await writeJson(path.join(tenantDir, 'config', 'boundary-rules.json'), {
      forbidden_patterns: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }, { id: 'f5' }],
      drift_patterns: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }],
    })
    await writeJson(path.join(tenantDir, 'state', 'api-metrics.json'), {
      p95_ms: 320,
      error_rate: 0.01,
    })
    await writeJson(path.join(tenantDir, 'hermes', 'modules.json'), {
      modules: [
        { id: 'profile-setup', status: 'pass' },
        { id: 'boundary-watchdog', status: 'pass' },
        { id: 'skill-curator', status: 'pass' },
        { id: 'memory-curator', status: 'pass' },
        { id: 'output-checker', status: 'pass' },
        { id: 'guardian', status: 'pass' },
        { id: 'cron-governance', status: 'pass' },
      ],
    })
    await writeJson(path.join(tenantDir, 'hermes', 'budget-gate.json'), {
      status: 'pass',
      used_usd: 12,
      limit_usd: 25,
    })
    await writeJson(path.join(tenantDir, 'hermes', 'skill-curator.json'), { status: 'pass' })
    await writeJson(path.join(tenantDir, 'hermes', 'memory-audit.json'), { status: 'pass' })
    await writeJson(path.join(tenantDir, 'deploy-status.json'), { status: 'success', mode: 'mock' })
    await writeText(path.join(tenantDir, 'AGENTS.base.md'), '# AGENTS\n\nready')
    await writeText(path.join(tenantDir, 'logs', 'events.ndjson'), '{"level":"info","message":"ready"}\n')
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

  it('filters gate testing checks by selected base', async () => {
    const { GET } = await import('@/app/api/harness/gates/route')
    const ocResponse = await GET(new NextRequest('http://localhost/api/harness/gates?tenant=acme&base=oc'))
    const hermesResponse = await GET(new NextRequest('http://localhost/api/harness/gates?tenant=acme&base=hermes'))
    const bothResponse = await GET(new NextRequest('http://localhost/api/harness/gates?tenant=acme&base=both'))
    const ocBody = await ocResponse.json()
    const hermesBody = await hermesResponse.json()
    const bothBody = await bothResponse.json()

    expect(ocBody.base).toBe('oc')
    expect(ocBody.checks.map((check: { id: string }) => check.id)).toEqual(
      expect.arrayContaining(['oc-openclaw-gateway', 'oc-boundary-reload', 'oc-soul-load', 'shared-api-latency', 'shared-error-rate', 'shared-log-integrity']),
    )
    expect(ocBody.checks.map((check: { id: string }) => check.id)).not.toContain('hermes-halt-reader')

    expect(hermesBody.base).toBe('hermes')
    expect(hermesBody.checks.map((check: { id: string }) => check.id)).toEqual(
      expect.arrayContaining(['hermes-halt-reader', 'hermes-budget-gate', 'hermes-skill-curator', 'hermes-memory-audit', 'shared-api-latency']),
    )
    expect(hermesBody.checks.map((check: { id: string }) => check.id)).not.toContain('oc-openclaw-gateway')

    expect(bothBody.base).toBe('both')
    expect(bothBody.checks.map((check: { id: string }) => check.id)).toEqual(
      expect.arrayContaining(['oc-openclaw-gateway', 'hermes-halt-reader', 'shared-log-integrity']),
    )
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

  it('returns base-aware pre-launch RTS checks', async () => {
    const { GET } = await import('@/app/api/harness/pre-launch/route')
    const ocResponse = await GET(new NextRequest('http://localhost/api/harness/pre-launch?tenant=acme&base=oc'))
    const hermesResponse = await GET(new NextRequest('http://localhost/api/harness/pre-launch?tenant=acme&base=hermes'))
    const ocBody = await ocResponse.json()
    const hermesBody = await hermesResponse.json()

    expect(ocBody.base).toBe('oc')
    expect(ocBody.checks.map((check: { id: string }) => check.id)).toEqual(
      expect.arrayContaining(['oc-workspace-complete', 'oc-gateway-config', 'oc-boundary-finalized', 'shared-tenant-config', 'shared-api-key', 'shared-log-writable']),
    )
    expect(ocBody.checks.map((check: { id: string }) => check.id)).not.toContain('hermes-modules-pass')

    expect(hermesBody.base).toBe('hermes')
    expect(hermesBody.checks.map((check: { id: string }) => check.id)).toEqual(
      expect.arrayContaining(['hermes-modules-pass', 'hermes-no-halt-signal', 'hermes-budget-under-limit', 'shared-tenant-config', 'shared-api-key', 'shared-log-writable']),
    )
    expect(hermesBody.checks.map((check: { id: string }) => check.id)).not.toContain('oc-workspace-complete')
  })

  it('returns delivery report sections for a tenant', async () => {
    const { GET } = await import('@/app/api/harness/delivery-report/route')
    const response = await GET(new NextRequest('http://localhost/api/harness/delivery-report?tenant=acme'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.phase.id).toBe('P16')
    expect(body.report.status).toBe('ready')
    expect(body.sections.map((section: { id: string }) => section.id)).toEqual(
      expect.arrayContaining(['intake', 'build', 'gates', 'pre_launch', 'uat', 'handoff']),
    )
  })

  it('returns delivery sections and summary for both bases', async () => {
    const { GET } = await import('@/app/api/harness/delivery-report/route')
    const response = await GET(new NextRequest('http://localhost/api/harness/delivery-report?tenant=acme&base=both'))
    const body = await response.json()

    expect(body.base).toBe('both')
    expect(body.sections.map((section: { id: string }) => section.id)).toEqual(
      expect.arrayContaining(['oc-workspace', 'oc-boundary', 'oc-soul-agents', 'hermes-modules', 'hermes-guardrails', 'hermes-memory']),
    )
    expect(body.report.summary).toContain('ACME Intelligence')
  })
})
