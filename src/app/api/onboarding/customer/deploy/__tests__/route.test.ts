import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/harness-boundary', () => ({
  resolveHarnessRoot: async () => process.env.MC_HARNESS_ROOT,
}))

describe('POST /api/onboarding/customer/deploy', () => {
  const originalEnv = { ...process.env }
  let harnessRoot = ''
  const tenantId = 'demo-dry-run-2'

  function adminUser() {
    return {
      id: 1,
      username: 'clare-admin',
      display_name: 'Clare Admin',
      role: 'admin',
      workspace_id: 1,
      tenant_id: 1,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
    }
  }

  function request(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/onboarding/customer/deploy', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/onboarding/customer/deploy/route')
  }

  async function writeConfirmation() {
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    await mkdir(vaultDir, { recursive: true })
    await writeFile(path.join(vaultDir, 'confirmation-cc.md'), '# Confirmation CC\n\n| signed_by | clare-admin |\n', 'utf8')
  }

  beforeEach(async () => {
    harnessRoot = await mkdtempCompat('mc-ob-s4-')
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: harnessRoot,
    }
    authMock.requireRole.mockReset()
    authMock.requireRole.mockReturnValue({ user: adminUser() })
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(harnessRoot, { recursive: true, force: true })
  })

  it('lets an admin deploy with mock fallback and creates tenant vault tree', async () => {
    await writeConfirmation()
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.deploy_status.status).toBe('mock-success')
    expect(body.deploy_status.mode).toBe('mock-fallback')
    expect(body.container).toBe('tenant-demo-dry-run-2-mock')

    await expect(stat(path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/vault/Agent-Shared'))).resolves.toBeTruthy()
    await expect(stat(path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/vault/Agent-Main'))).resolves.toBeTruthy()
    await expect(stat(path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/vault/Agent-MediaIntel'))).resolves.toBeTruthy()
    await expect(stat(path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/vault/Agent-Web3Research'))).resolves.toBeTruthy()
    await expect(stat(path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/vault/skills'))).resolves.toBeTruthy()
    await expect(readFile(path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/deploy-status.json'), 'utf8')).resolves.toContain('mock-fallback')
  })

  it.each([
    ['operator', 403],
    ['customer', 403],
    ['no-cookie', 401],
  ])('rejects %s access', async (_caseName, status) => {
    authMock.requireRole.mockReturnValue({
      error: status === 401 ? 'Authentication required' : 'Requires admin role or higher',
      status,
    })
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(status)
    expect(body.error).toBeTruthy()
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'admin')
  })

  it('returns a clear error when confirmation-cc.md is missing', async () => {
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('vault/confirmation-cc.md is required')
  })

  it('is idempotent when deploy-status.json already exists', async () => {
    await writeConfirmation()
    const tenantRoot = path.join(harnessRoot, 'phase0/tenants', tenantId)
    await mkdir(tenantRoot, { recursive: true })
    const existingStatus = {
      status: 'mock-success',
      mode: 'mock-fallback',
      container: 'tenant-demo-dry-run-2-mock',
      deployed_at: '2026-04-27T00:00:00.000Z',
      vault_initialized: true,
      note: 'existing deploy',
    }
    await writeFile(path.join(tenantRoot, 'deploy-status.json'), `${JSON.stringify(existingStatus, null, 2)}\n`, 'utf8')

    const { POST } = await loadRoute()
    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.already_deployed).toBe(true)
    expect(body.deploy_status.deployed_at).toBe('2026-04-27T00:00:00.000Z')
    await expect(readFile(path.join(tenantRoot, 'deploy-status.json'), 'utf8')).resolves.toContain('existing deploy')
  })

  it('writes the expected mock fallback deploy-status.json when no new-tenant script exists', async () => {
    await writeConfirmation()
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()
    const statusContent = await readFile(path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/deploy-status.json'), 'utf8')

    expect(response.status).toBe(200)
    expect(body.deploy_status.vault_initialized).toBe(true)
    expect(body.deploy_status.note).toContain('Docker daemon 不可用')
    expect(JSON.parse(statusContent)).toMatchObject({
      status: 'mock-success',
      mode: 'mock-fallback',
      container: 'tenant-demo-dry-run-2-mock',
      vault_initialized: true,
    })
  })

  it('uses new-tenant.sh when present and returns script container info', async () => {
    await writeConfirmation()
    const scriptsDir = path.join(harnessRoot, 'phase0/scripts')
    await mkdir(scriptsDir, { recursive: true })
    const scriptPath = path.join(scriptsDir, 'new-tenant.sh')
    await writeFile(scriptPath, '#!/usr/bin/env bash\necho "container=tenant-$1-script"\n', 'utf8')
    await chmod(scriptPath, 0o755)

    const { POST } = await loadRoute()
    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deploy_status.status).toBe('success')
    expect(body.deploy_status.mode).toBe('new-tenant-script')
    expect(body.container).toBe('tenant-demo-dry-run-2-script')
    expect(body.deploy_status.script_path).toBe(scriptPath)
  })
})

async function mkdtempCompat(prefix: string) {
  const { mkdtemp } = await import('node:fs/promises')
  return mkdtemp(path.join(os.tmpdir(), prefix))
}
