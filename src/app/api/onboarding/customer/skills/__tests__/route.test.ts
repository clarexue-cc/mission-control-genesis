import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

describe('POST /api/onboarding/customer/skills', () => {
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
      {
        order: 2,
        name: '多渠道信号核验',
        actor: 'Agent',
        trigger: '主题矩阵确认后',
        output: '可追溯证据包',
        next: 'source-evidence-mapper',
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
      {
        id: 'source-evidence-mapper',
        title: 'Source Evidence Mapper',
        order: 2,
        workflow_stage: '多渠道信号核验',
        inputs: ['Telegram/X/公众号信号', '项目名', '时间窗口'],
        outputs: ['来源链接', '交叉验证结果', '不确定性备注'],
        handoff: '交给 daily-risk-brief-composer',
        human_confirmation: '需要 Clare 复核',
        reason: '确保每条舆情判断都能追溯到公开来源和核验状态。',
      },
    ],
    delivery_mode: 'Hybrid',
    delivery_mode_reason: '固定日报流程和人工确认并存。',
    boundary_draft: ['禁泄密', '禁越权', '禁外发', '禁假数据'],
    uat_criteria: ['能生成 morning brief', '保留来源链接', '高风险需人工确认'],
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

  function request(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/onboarding/customer/skills', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/onboarding/customer/skills/route')
  }

  async function writeP4Blueprint() {
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    await mkdir(vaultDir, { recursive: true })
    const intakeRaw = '# Intake Raw\n\nmedia-intel-v1 monitors Telegram, X, public accounts, and industry news.\n'
    const intakeHash = createHash('sha256').update(intakeRaw).digest('hex')
    await writeFile(path.join(vaultDir, 'intake-raw.md'), intakeRaw, 'utf8')
    await writeFile(path.join(vaultDir, 'intake-analysis.md'), `# Intake Analysis

> Mode: llm-anthropic
> Provider: anthropic
> Intake Raw Hash: ${intakeHash}

## 机器可读蓝图 JSON

\`\`\`json
${JSON.stringify(p4Draft, null, 2)}
\`\`\`
`, 'utf8')
  }

  async function writeOpenUatTask() {
    const uatPath = path.join(harnessRoot, 'phase0/tenants', tenantId, 'uat-tasks.jsonl')
    await mkdir(path.dirname(uatPath), { recursive: true })
    await appendFile(uatPath, `${JSON.stringify({
      id: 'uat_p21_skill_review',
      tenant_id: tenantId,
      title: 'P21 验证 Media Intel Skills',
      description: '客户正在验证 P9 注入后的 Skill 行为。',
      status: 'open',
      created_by: 'clare-admin',
      created_at: '2026-04-29T00:00:00.000Z',
    })}\n`, 'utf8')
  }

  beforeEach(async () => {
    harnessRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-ob-p9-'))
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

  it('lets an admin generate customer-specific Skill files from the P4 blueprint', async () => {
    await writeP4Blueprint()
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.created).toBe(2)
    expect(body.skills_dir).toBe('phase0/tenants/media-intel-v1/vault/skills')
    expect(body.generated[0]).toMatchObject({
      skill_id: 'media-intel-topic-planner',
      skill_name: 'media-intel-topic-planner',
      status: 'created',
    })
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.any(NextRequest), 'admin')

    const skillPath = path.join(harnessRoot, 'phase0/tenants/media-intel-v1/vault/skills/media-intel-topic-planner.md')
    await expect(stat(skillPath)).resolves.toBeTruthy()
    const content = await readFile(skillPath, 'utf8')
    expect(content).toContain('# Media Intel Topic Planner')
    expect(content).toContain('| order | 1 |')
    expect(content).toContain('| workflow_stage | 客户监控主题配置 |')
    expect(content).toContain('| inputs | intake-raw.md / 客户关注项目 / 渠道清单 |')
    expect(content).toContain('| outputs | 监控主题矩阵 / 风险阈值 |')
    expect(content).toContain('| handoff | 交给 source-evidence-mapper |')
    expect(content).toContain('| human_confirmation | 不需要 |')
    expect(content).toContain('| reason | 把 media-intel-v1 的关注项目、渠道和风险阈值转成可执行监控配置。 |')
  })

  it('reports Draft, Tenant, and UAT lifecycle status for P9 onboarding cards', async () => {
    await writeP4Blueprint()
    const { GET, POST } = await loadRoute()

    const draftResponse = await GET(new NextRequest(`http://localhost/api/onboarding/customer/skills?tenant_id=${tenantId}`))
    const draftBody = await draftResponse.json()

    expect(draftResponse.status).toBe(200)
    expect(draftBody.ok).toBe(true)
    expect(draftBody.skills).toHaveLength(2)
    expect(draftBody.skills[0]).toMatchObject({
      skill_id: 'media-intel-topic-planner',
      skill_name: 'media-intel-topic-planner',
      title: 'Media Intel Topic Planner',
      order: 1,
      workflow_stage: '客户监控主题配置',
      inputs: ['intake-raw.md', '客户关注项目', '渠道清单'],
      outputs: ['监控主题矩阵', '风险阈值'],
      handoff: '交给 source-evidence-mapper',
      human_confirmation: '不需要',
      reason: '把 media-intel-v1 的关注项目、渠道和风险阈值转成可执行监控配置。',
      lifecycle_status: 'Draft',
      vault_path: 'vault/skills/media-intel-topic-planner.md',
      path: 'phase0/tenants/media-intel-v1/vault/skills/media-intel-topic-planner.md',
    })

    await POST(request({ tenant_id: tenantId }))
    const tenantResponse = await GET(new NextRequest(`http://localhost/api/onboarding/customer/skills?tenant_id=${tenantId}`))
    const tenantBody = await tenantResponse.json()

    expect(tenantResponse.status).toBe(200)
    expect(tenantBody.uat_feedback_active).toBe(false)
    expect(tenantBody.skills.map((skill: any) => skill.lifecycle_status)).toEqual(['Tenant', 'Tenant'])

    await writeOpenUatTask()
    const uatResponse = await GET(new NextRequest(`http://localhost/api/onboarding/customer/skills?tenant_id=${tenantId}`))
    const uatBody = await uatResponse.json()

    expect(uatResponse.status).toBe(200)
    expect(uatBody.uat_feedback_active).toBe(true)
    expect(uatBody.skills.map((skill: any) => skill.lifecycle_status)).toEqual(['UAT', 'UAT'])
  })

  it('rejects non-admin generation', async () => {
    authMock.requireRole.mockReturnValue({ error: 'Requires admin role or higher', status: 403 })
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Requires admin')
  })

  it('returns a clear error when P4 analysis is missing', async () => {
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    await mkdir(vaultDir, { recursive: true })
    await writeFile(path.join(vaultDir, 'intake-raw.md'), '# Intake Raw\n\nOnly intake exists.\n', 'utf8')
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('vault/intake-analysis.md is required')
  })

  it('is idempotent when Skill files already match the P4 blueprint', async () => {
    await writeP4Blueprint()
    const { POST } = await loadRoute()
    await POST(request({ tenant_id: tenantId }))
    const skillPath = path.join(harnessRoot, 'phase0/tenants/media-intel-v1/vault/skills/media-intel-topic-planner.md')
    const firstContent = await readFile(skillPath, 'utf8')

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.created).toBe(0)
    expect(body.unchanged).toBe(2)
    expect(body.generated.map((item: any) => item.status)).toEqual(['unchanged', 'unchanged'])
    await expect(readFile(skillPath, 'utf8')).resolves.toBe(firstContent)
  })
})
