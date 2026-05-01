import { createHash } from 'node:crypto'
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

describe('GET /api/onboarding/customer/blueprint', () => {
  const originalEnv = { ...process.env }
  const tenantId = 'media-intel-v1'
  let harnessRoot = ''

  const p4Draft = {
    workflow_steps: [
      {
        order: 1,
        name: '客户监控主题配置',
        actor: 'Agent',
        trigger: 'intake 上传后',
        output: '监控主题矩阵',
        next: 'media-intel-topic-planner',
      },
    ],
    skill_candidates: [
      {
        id: 'media-intel-topic-planner',
        title: 'Media Intel Topic Planner',
        order: 1,
        workflow_stage: '客户监控主题配置',
        inputs: ['intake-raw.md', '客户关注项目', '渠道清单'],
        outputs: ['监控主题矩阵', '风险阈值'],
        handoff: '交给 source-evidence-mapper',
        human_confirmation: '不需要',
        reason: '把 media-intel-v1 的关注项目、渠道和风险阈值转成可执行监控配置。',
      },
    ],
    delivery_mode: 'Hybrid',
    delivery_mode_reason: '固定日报流程和人工确认并存。',
    boundary_draft: [
      '不得输出没有来源链接的风险判断。',
      '不得未经 Clare 确认对外发送高风险提醒。',
      '不得读取未授权私密群聊或付费内容。',
      '不得把不确定传闻写成已证实结论。',
    ],
    uat_criteria: [
      '给定 Web3 项目名后生成 morning brief。',
      '每条风险判断保留来源链接。',
      '高风险提醒进入人工确认状态。',
    ],
    soul_draft: {
      name: 'Media Intel Assistant',
      role: '生成媒体情报简报。',
      tone: '清晰审慎',
      forbidden: ['无来源结论', '自动外发'],
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

  function request(query = `?tenant_id=${tenantId}`) {
    return new NextRequest(`http://localhost/api/onboarding/customer/blueprint${query}`)
  }

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/onboarding/customer/blueprint/route')
  }

  async function writeP4Blueprint(opts: { stale?: boolean } = {}) {
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    await mkdir(vaultDir, { recursive: true })
    const intakeRaw = '# Intake Raw\n\nmedia-intel-v1 monitors Telegram, X, public accounts, and industry news.\n'
    const intakeHash = createHash('sha256').update(intakeRaw).digest('hex')
    await writeFile(path.join(vaultDir, 'intake-raw.md'), intakeRaw, 'utf8')
    await writeFile(path.join(vaultDir, 'intake-analysis.md'), `# Intake Analysis

> Mode: llm-anthropic
> Provider: anthropic
> Intake Raw Hash: ${opts.stale ? '0'.repeat(64) : intakeHash}

## 机器可读蓝图 JSON

\`\`\`json
${JSON.stringify(p4Draft, null, 2)}
\`\`\`
`, 'utf8')
  }

  beforeEach(async () => {
    harnessRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-ob-blueprint-'))
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

  it('returns P8, P9, and P18 machine-readable P4 drafts for admins', async () => {
    await writeP4Blueprint()
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.tenant_id).toBe(tenantId)
    expect(body.skills_blueprint[0]).toMatchObject({
      id: 'media-intel-topic-planner',
      order: 1,
      workflow_stage: '客户监控主题配置',
      inputs: ['intake-raw.md', '客户关注项目', '渠道清单'],
      outputs: ['监控主题矩阵', '风险阈值'],
      handoff: '交给 source-evidence-mapper',
      human_confirmation: '不需要',
      reason: '把 media-intel-v1 的关注项目、渠道和风险阈值转成可执行监控配置。',
    })
    expect(body.boundary_rules.forbidden_patterns).toHaveLength(4)
    expect(body.boundary_rules.forbidden_patterns[0]).toMatchObject({
      id: 'p4-boundary-1',
      category: 'customer-media-intel-v1',
      action: 'block',
    })
    expect(body.uat_tasks).toHaveLength(3)
    expect(body.uat_tasks[0]).toMatchObject({
      id: 'p4-uat-1',
      tenant_id: tenantId,
      source: 'p4-blueprint',
    })
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.any(NextRequest), 'admin')
  })

  it('rejects non-admin blueprint reads', async () => {
    authMock.requireRole.mockReturnValue({ error: 'Requires admin role or higher', status: 403 })
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Requires admin')
  })

  it('rejects stale P4 analysis before loading drafts', async () => {
    await writeP4Blueprint({ stale: true })
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toContain('different intake-raw.md hash')
  })
})
