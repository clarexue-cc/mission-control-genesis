import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

vi.mock('server-only', () => ({}))

describe('GET /api/onboarding/customer/skills/inventory', () => {
  const originalEnv = { ...process.env }
  let harnessRoot = ''

  const adminUser = {
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

  function request() {
    return new NextRequest('http://localhost/api/onboarding/customer/skills/inventory')
  }

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/onboarding/customer/skills/inventory/route')
  }

  async function writeSkill(tenantId: string, skillName: string, content: string) {
    const skillsDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault/skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(path.join(skillsDir, `${skillName}.md`), content, 'utf8')
  }

  beforeEach(async () => {
    harnessRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-skills-inventory-'))
    await mkdir(path.join(harnessRoot, 'phase0/tenants'), { recursive: true })
    await writeFile(path.join(harnessRoot, 'package.json'), JSON.stringify({ name: 'fixture-harness' }), 'utf8')
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: harnessRoot,
    }
    authMock.requireRole.mockReset()
    authMock.requireRole.mockReturnValue({ user: adminUser })
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(harnessRoot, { recursive: true, force: true })
  })

  it('returns read-only tenant Skill inventory across valid tenants', async () => {
    await writeSkill('ceo-assistant-v1', 'course-ppt-generator', `# 课程 PPT 生成

> Source: P9 customer-specific Skill file

把课程大纲生成可交付 PPT。
`)
    await writeSkill('web3-research-v1', 'onchain-data-checker', `# 链上数据核验

> Source: P9 customer-specific Skill file

核验链上地址、交易和资金流信号。
`)
    await writeSkill('invalid tenant', 'should-not-leak', '# Bad\n\nThis must be ignored.\n')
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.total).toBe(2)
    expect(body.skills).toEqual([
      expect.objectContaining({
        tenant_id: 'ceo-assistant-v1',
        skill_name: 'course-ppt-generator',
        title: '课程 PPT 生成',
        vault_path: 'vault/skills/course-ppt-generator.md',
        path: 'phase0/tenants/ceo-assistant-v1/vault/skills/course-ppt-generator.md',
        excerpt: '把课程大纲生成可交付 PPT。',
      }),
      expect.objectContaining({
        tenant_id: 'web3-research-v1',
        skill_name: 'onchain-data-checker',
        title: '链上数据核验',
        vault_path: 'vault/skills/onchain-data-checker.md',
        path: 'phase0/tenants/web3-research-v1/vault/skills/onchain-data-checker.md',
        excerpt: '核验链上地址、交易和资金流信号。',
      }),
    ])
    expect(JSON.stringify(body.skills)).not.toContain('invalid tenant')
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.any(NextRequest), 'viewer')
  })

  it('rejects unauthenticated inventory reads', async () => {
    authMock.requireRole.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toContain('Authentication required')
  })
})
