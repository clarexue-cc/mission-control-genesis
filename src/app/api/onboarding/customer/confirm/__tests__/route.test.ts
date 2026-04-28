import { createHash } from 'node:crypto'
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
  const defaultIntakeRaw = '# Intake Raw\n\n客户原话：demo-dry-run-2 需要自动部署。\n'
  const p4Draft = {
    workflow_steps: [
      { order: 1, name: '客户蓝图确认', actor: 'Clare', trigger: 'P4 完成', output: '可部署蓝图', next: 'tenant-deploy' },
    ],
    skill_candidates: [
      {
        id: 'tenant-deploy-planner',
        title: 'Tenant Deploy Planner',
        order: 1,
        workflow_stage: '客户蓝图确认',
        inputs: ['intake-analysis.md'],
        outputs: ['部署确认'],
        handoff: '交给 P6 Deploy',
        human_confirmation: '需要 Clare 审批',
        reason: '确认 P4 蓝图后再进入部署。',
      },
    ],
    delivery_mode: 'Hybrid',
    delivery_mode_reason: '固定部署流程和人工审批并存。',
    boundary_draft: ['不得越权部署。', '不得泄露客户资料。', '不得跳过人工审批。', '不得编造验收结果。'],
    uat_criteria: ['审批后可部署。', '部署记录可追溯。', '确认文档包含 P4 hash。'],
    soul_draft: {
      name: '审批助手',
      role: '辅助 Clare 审批 P4 蓝图。',
      tone: '清晰审慎',
      forbidden: ['跳过审批'],
    },
  }

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

  async function writeIntakeRaw(content = defaultIntakeRaw) {
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    await mkdir(vaultDir, { recursive: true })
    await writeFile(path.join(vaultDir, 'intake-raw.md'), content, 'utf8')
    return content
  }

  async function writeP4Analysis(intakeRawContent = defaultIntakeRaw, extra = '') {
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    await mkdir(vaultDir, { recursive: true })
    const intakeHash = createHash('sha256').update(intakeRawContent).digest('hex')
    await writeFile(path.join(vaultDir, 'intake-analysis.md'), `# Intake Analysis

> Mode: mock-fallback
> Provider: mock
> Intake Raw Hash: ${intakeHash}

## 机器可读蓝图 JSON

\`\`\`json
${JSON.stringify(p4Draft, null, 2)}
\`\`\`
${extra}
`, 'utf8')
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
    const intakeRaw = await writeIntakeRaw()
    await writeP4Analysis(intakeRaw)
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
    expect(body.content).toContain('intake_analysis_hash |')

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

  it('returns a clear error when P4 intake-analysis.md is missing', async () => {
    await writeIntakeRaw()
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('vault/intake-analysis.md is required')
  })

  it('is idempotent and does not overwrite an existing confirmation', async () => {
    const intakeRaw = await writeIntakeRaw()
    await writeP4Analysis(intakeRaw)
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

  it('can explicitly replace an existing confirmation after P4 approval changes', async () => {
    const intakeRaw = await writeIntakeRaw()
    await writeP4Analysis(intakeRaw, '\nupdated blueprint\n')
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    const confirmationPath = path.join(vaultDir, 'confirmation-cc.md')
    await writeFile(confirmationPath, '# Confirmation CC\n\nlegacy signature without P4 hash\n', 'utf8')

    const { POST } = await loadRoute()
    const response = await POST(request({
      tenant_id: tenantId,
      confirmation_text: 'Clare 重新审批当前 P4 蓝图。',
      replace_existing: true,
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.already_exists).toBe(true)
    expect(body.replaced_existing).toBe(true)
    expect(body.content).toContain('Clare 重新审批当前 P4 蓝图')
    expect(body.content).toContain('intake_analysis_hash |')
    await expect(readFile(confirmationPath, 'utf8')).resolves.toContain('intake_analysis_hash |')
  })
})

async function mkdtempCompat(prefix: string) {
  const { mkdtemp } = await import('node:fs/promises')
  return mkdtemp(path.join(os.tmpdir(), prefix))
}
