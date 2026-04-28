import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { selectCustomerAnalysisProvider } from '@/lib/customer-analysis'

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/harness-boundary', () => ({
  resolveHarnessRoot: async () => process.env.MC_HARNESS_ROOT,
}))

describe('POST /api/onboarding/customer/analyze', () => {
  const originalEnv = { ...process.env }
  let harnessRoot = ''
  const tenantId = 'media-intel-v1'

  const llmDraft = {
    workflow_steps: [
      {
        order: 1,
        name: '客户监控主题配置',
        actor: 'Agent',
        trigger: 'intake 上传后',
        output: '监控主题、渠道和风险阈值',
        next: 'media-intel-topic-planner',
      },
      {
        order: 2,
        name: '多渠道信号核验',
        actor: 'Agent',
        trigger: '上下文确认后',
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
        inputs: ['intake-raw.md', '客户关注的 Web3 项目', '渠道清单'],
        outputs: ['监控主题矩阵', '风险阈值', '每日简报栏目'],
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
        reason: 'media-intel-v1 需要每条舆情判断都能追溯到公开来源和核验状态。',
      },
      {
        id: 'daily-risk-brief-composer',
        title: 'Daily Risk Brief Composer',
        order: 3,
        workflow_stage: '每日舆情简报',
        inputs: ['证据包', '风险阈值', '客户关注栏目'],
        outputs: ['Morning brief', '高风险提醒', '待确认结论'],
        handoff: '交给后续部署',
        human_confirmation: '需要 Clare 复核',
        reason: '把核验后的媒体信号整理成 media-intel-v1 可验收的每日风险简报。',
      },
    ],
    delivery_mode: 'Hybrid',
    delivery_mode_reason: '需要流程编排和工具调用并存。',
    boundary_draft: ['禁泄密', '禁越权', '禁外发', '禁假数据'],
    uat_criteria: ['覆盖 P1-P22', '响应状态清晰', '摘要准确'],
    soul_draft: {
      name: '客户分析助手',
      role: '分析 intake 并产出交付草案。',
      tone: '专业清晰',
      forbidden: ['泄密', '越权'],
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
    return new NextRequest('http://localhost/api/onboarding/customer/analyze', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/onboarding/customer/analyze/route')
  }

  async function writeIntakeRaw(content = `# Intake Raw

客户：media-intel-v1

客户原话：
- 每天监控 Telegram、X、公众号和行业新闻里的 Web3 项目舆情。
- 重点看融资、监管、KOL 争议、交易所上线和安全事故。
- 输出 morning brief，要保留来源链接、发布时间、风险等级和不确定性备注。
- 高风险判断、对外提醒和客户邮件必须 Clare 先确认。
`) {
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    await mkdir(vaultDir, { recursive: true })
    await writeFile(path.join(vaultDir, 'intake-raw.md'), content, 'utf8')
  }

  beforeEach(async () => {
    harnessRoot = await mkdtempCompat('mc-ob-s2-')
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: harnessRoot,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
    }
    authMock.requireRole.mockReset()
    authMock.requireRole.mockReturnValue({ user: adminUser() })
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.unstubAllGlobals()
    vi.resetModules()
    await rm(harnessRoot, { recursive: true, force: true })
  })

  it('lets an admin analyze with mock fallback and creates intake-analysis.md', async () => {
    await writeIntakeRaw()
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('mock-fallback')
    expect(body.provider).toBe('mock')
    expect(body.path).toBe('phase0/tenants/media-intel-v1/vault/intake-analysis.md')
    expect(body.workflow_steps.length).toBeGreaterThanOrEqual(3)
    expect(body.skill_candidates.map((skill: { id: string }) => skill.id)).toContain('media-intel-signal-collector')
    expect(body.content).toContain('media-intel-signal-collector')
    expect(body.content).not.toContain('media-monitor')
    expect(body.content).not.toContain('data-aggregator')
    expect(body.content).not.toContain('content-summarizer')
    expect(body.content).toContain('## 候选 Skills')
    expect(body.content).toContain('## 客户 Workflow 拆解')
    expect(body.content).toContain('## 候选 Skills 蓝图')
    expect(body.content).toContain('## Boundary 草稿')
    await expect(stat(path.join(harnessRoot, 'phase0/tenants/media-intel-v1/vault/intake-analysis.md'))).resolves.toBeTruthy()
  })

  it('uses Anthropic LLM mode when ANTHROPIC_API_KEY is configured', async () => {
    await writeIntakeRaw()
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(llmDraft) }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('llm-anthropic')
    expect(body.provider).toBe('anthropic')
    expect(body.workflow_steps).toHaveLength(2)
    expect(body.skill_candidates).toHaveLength(3)
    expect(body.skill_candidates[0].inputs).toContain('intake-raw.md')
    expect(body.content).toContain('media-intel-topic-planner')
    expect(body.content).not.toContain('media-monitor')
    expect(body.content).not.toContain('data-aggregator')
    expect(body.content).not.toContain('content-summarizer')
    expect(body.content).not.toContain('sk-ant-test-secret')
    const fetchCalls = fetchMock.mock.calls as unknown[][]
    expect(fetchCalls[0]?.[0]).toBe('https://api.anthropic.com/v1/messages')
    const fetchOptions = fetchCalls[0]?.[1] as RequestInit
    const promptBody = JSON.parse(String(fetchOptions.body)) as { messages: Array<{ content: string }> }
    const prompt = promptBody.messages[0].content
    expect(prompt).toContain('media-intel-v1')
    expect(prompt).toContain('Telegram、X、公众号')
    expect(prompt).toContain('customer-specific workflow Skills')
    expect(prompt).toContain('media-monitor / data-aggregator / content-summarizer')
  })

  it('falls back when the LLM returns generic demo skill ids', async () => {
    await writeIntakeRaw()
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret'
    const genericDraft = {
      ...llmDraft,
      skill_candidates: [
        { ...llmDraft.skill_candidates[0], id: 'media-monitor', title: 'Media Monitor' },
        { ...llmDraft.skill_candidates[1], id: 'data-aggregator', title: 'Data Aggregator' },
        { ...llmDraft.skill_candidates[2], id: 'content-summarizer', title: 'Content Summarizer' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(genericDraft) }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('mock-fallback')
    expect(body.provider).toBe('mock')
    expect(body.skill_candidates.map((skill: { id: string }) => skill.id)).toContain('media-intel-signal-collector')
    expect(body.content).not.toContain('media-monitor')
    expect(body.content).not.toContain('data-aggregator')
    expect(body.content).not.toContain('content-summarizer')
    expect(body.content).toContain('LLM 调用失败')
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

  it('is idempotent and does not overwrite an existing analysis', async () => {
    await writeIntakeRaw()
    const analysisPath = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault/intake-analysis.md')
    const intakeRaw = await readFile(path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault/intake-raw.md'), 'utf8')
    const { createHash } = await import('node:crypto')
    const intakeHash = createHash('sha256').update(intakeRaw).digest('hex')
    const existingContent = `# Intake Analysis\n\n> Mode: mock-fallback\n> Intake Raw Hash: ${intakeHash}\n\nexisting analysis\n`
    await writeFile(analysisPath, existingContent, 'utf8')

    const { POST } = await loadRoute()
    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.already_exists).toBe(true)
    expect(body.content).toBe(existingContent)
    await expect(readFile(analysisPath, 'utf8')).resolves.toBe(existingContent)
  })

  it('rejects stale analysis when the saved intake hash differs from current intake-raw', async () => {
    await writeIntakeRaw()
    const analysisPath = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault/intake-analysis.md')
    await writeFile(analysisPath, '# Intake Analysis\n\n> Mode: mock-fallback\n> Intake Raw Hash: 0000000000000000000000000000000000000000000000000000000000000000\n\nstale analysis\n', 'utf8')

    const { POST } = await loadRoute()
    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toContain('different intake-raw.md hash')
  })

  it('writes the required mock fallback structure', async () => {
    await writeIntakeRaw()
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.skill_candidates.length).toBeGreaterThanOrEqual(3)
    expect(body.workflow_steps.length).toBeGreaterThanOrEqual(3)
    expect(body.delivery_mode).toBe('Hybrid')
    expect(body.boundary_draft).toHaveLength(4)
    expect(body.uat_criteria).toHaveLength(3)
    expect(body.content).toContain('mode')
    expect(body.content).toContain('mock-fallback')
  })

  it('falls back gracefully when LLM fails without exposing API keys', async () => {
    await writeIntakeRaw()
    process.env.OPENAI_API_KEY = 'sk-test-openai-secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream failed', { status: 500 })))
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('mock-fallback')
    expect(body.provider).toBe('mock')
    expect(body.content).toContain('LLM 调用失败')
    expect(body.content).not.toContain('sk-test-openai-secret')
  })

  it('detects provider priority as Anthropic before OpenAI', () => {
    expect(selectCustomerAnalysisProvider({
      ANTHROPIC_API_KEY: 'anthropic-key',
      OPENAI_API_KEY: 'openai-key',
    } as unknown as NodeJS.ProcessEnv)).toBe('anthropic')
    expect(selectCustomerAnalysisProvider({
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: 'openai-key',
    } as unknown as NodeJS.ProcessEnv)).toBe('openai')
    expect(selectCustomerAnalysisProvider({} as unknown as NodeJS.ProcessEnv)).toBeNull()
  })
})

async function mkdtempCompat(prefix: string) {
  const { mkdtemp } = await import('node:fs/promises')
  return mkdtemp(path.join(os.tmpdir(), prefix))
}
