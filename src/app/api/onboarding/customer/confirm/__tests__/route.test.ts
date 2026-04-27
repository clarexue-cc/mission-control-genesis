import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

describe('POST /api/onboarding/customer/confirm', () => {
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
    return new NextRequest('http://localhost/api/onboarding/customer/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/onboarding/customer/confirm/route')
  }

  async function writeIntakeRaw(content = '# Intake Raw\n\n客户原话：demo-dry-run-2 需要自动部署。\n') {
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    await mkdir(vaultDir, { recursive: true })
    await writeFile(path.join(vaultDir, 'intake-raw.md'), content, 'utf8')
  }

  beforeEach(async () => {
    harnessRoot = await mkdtempCompat('mc-ob-s3-')
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

  it('lets an admin sign successfully and creates confirmation-cc.md', async () => {
    await writeIntakeRaw()
    const { POST } = await loadRoute()

    const response = await POST(request({
      tenant_id: tenantId,
      confirmation_text: 'Clare 已审阅，确认开始 tenant 部署。',
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.already_exists).toBe(false)
    expect(body.path).toBe('phase0/tenants/demo-dry-run-2/vault/confirmation-cc.md')
    expect(body.content).toContain('signed_by | clare-admin')
    expect(body.content).toContain('timestamp |')
    expect(body.content).toContain('intake_raw_hash |')

    const physicalPath = path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/vault/confirmation-cc.md')
    await expect(stat(physicalPath)).resolves.toBeTruthy()
    await expect(readFile(physicalPath, 'utf8')).resolves.toContain('Clare 已审阅')
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

  it('returns a clear error when intake-raw.md is missing', async () => {
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('vault/intake-raw.md is required')
  })

  it('is idempotent and does not overwrite an existing confirmation', async () => {
    await writeIntakeRaw()
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    const confirmationPath = path.join(vaultDir, 'confirmation-cc.md')
    const existingContent = '# Confirmation CC\n\nexisting signature\n'
    await writeFile(confirmationPath, existingContent, 'utf8')

    const { POST } = await loadRoute()
    const response = await POST(request({
      tenant_id: tenantId,
      confirmation_text: 'new text should not overwrite',
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.already_exists).toBe(true)
    expect(body.message).toContain('already exists')
    expect(body.content).toBe(existingContent)
    await expect(readFile(confirmationPath, 'utf8')).resolves.toBe(existingContent)
  })
})

async function mkdtempCompat(prefix: string) {
  const { mkdtemp } = await import('node:fs/promises')
  return mkdtemp(path.join(os.tmpdir(), prefix))
}
