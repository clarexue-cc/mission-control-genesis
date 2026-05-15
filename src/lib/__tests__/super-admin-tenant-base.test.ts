import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => ({
  tenantRows: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: () => ({
      all: () => rows.tenantRows,
    }),
  }),
  appendProvisionEvent: vi.fn(),
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/command', () => ({
  runCommand: vi.fn(),
}))

vi.mock('@/lib/provisioner-client', () => ({
  runProvisionerCommand: vi.fn(),
}))

vi.mock('@/lib/config', () => ({
  config: { dataDir: '/tmp/mission-control-test' },
}))

const originalEnv = { ...process.env }
let harnessRoot = ''

describe('super admin tenant base detection', () => {
  beforeEach(() => {
    vi.resetModules()
    harnessRoot = path.join(tmpdir(), `mc-tenant-base-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    process.env = { ...originalEnv, MC_HARNESS_ROOT: harnessRoot }
    rows.tenantRows = [{
      id: 2,
      slug: 'media-intel-agent',
      display_name: 'media-intel-agent',
      linux_user: 'media-intel-agent',
      plan_tier: 'customer',
      status: 'active',
      openclaw_home: '',
      workspace_root: '',
      gateway_port: null,
      dashboard_port: null,
      config: '{}',
      created_by: 'test',
      owner_gateway: null,
      created_at: 1,
      updated_at: 1,
      latest_job_id: null,
      latest_job_status: null,
      latest_job_created_at: null,
    }]
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    rows.tenantRows = []
    if (harnessRoot) rmSync(harnessRoot, { recursive: true, force: true })
    harnessRoot = ''
    vi.resetModules()
  })

  it('falls back to workspace-state base when tenant config has no base', async () => {
    const stateDir = path.join(
      harnessRoot,
      'phase0',
      'tenants',
      'media-intel-agent',
      'workspace',
      '.openclaw',
    )
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(path.join(stateDir, 'workspace-state.json'), JSON.stringify({ base: 'hermes' }), 'utf8')

    const { listTenants } = await import('@/lib/super-admin')

    expect(listTenants()[0]).toMatchObject({
      slug: 'media-intel-agent',
      base: 'hermes',
    })
  })
})
