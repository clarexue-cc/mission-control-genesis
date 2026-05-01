import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectUnresolvedPlaceholders,
  selectCustomerSoulProvider,
} from '@/lib/customer-soul'

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/harness-boundary', () => ({
  resolveHarnessRoot: async () => process.env.MC_HARNESS_ROOT,
}))

describe('POST /api/onboarding/customer/soul', () => {
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
    return new NextRequest('http://localhost/api/onboarding/customer/soul', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/onboarding/customer/soul/route')
  }

  function llmDraft(suffix = '') {
    return {
      soul_md: `# SOUL

> Source: OB-S5 customer onboarding
> Mode: llm-anthropic
> Provider: anthropic
> Tenant: ${tenantId}

## 角色定义

- 名称：客户分析助手${suffix}
- 核心职责：生成交付配置。
- 语气风格：专业清晰。

## 工作原则

1. 读取 intake-analysis.md。

## 禁止行为

1. 禁止泄密。

## UAT 对齐

1. 覆盖 P1-P16。
`,
      agents_md: `# AGENTS

> Source: OB-S5 customer onboarding
> Mode: llm-anthropic
> Provider: anthropic
> Tenant: ${tenantId}

## Agent-Main

- persona: 客户分析助手${suffix}
- tone: 专业清晰
- operating_mode: Hybrid

## Skills

- media-monitor

## 工作规范

1. 不跨 tenant。
`,
    }
  }

  async function writeAnalysis(content = `# Intake Analysis

> Source: OB-S2 AI analysis
> Mode: mock-fallback
> Provider: mock

## 候选 Skills

- media-monitor: Media Monitor — 持续跟踪公开渠道。
- data-aggregator: Data Aggregator — 汇总素材和指标。
- content-summarizer: Content Summarizer — 生成摘要和行动项。

## Pipeline / Toolkit / Hybrid 判断

| Field | Value |
|---|---|
| tenant_id | demo-dry-run-2 |
| recommended_mode | Hybrid |
| reason | 同时需要流程和工具。 |

## Boundary 草稿

1. 禁止泄露敏感信息。
2. 禁止越权访问。
3. 禁止未授权外发。
4. 禁止编造验证结果。

## UAT 标准

1. 覆盖 P1-P16。
2. 状态清晰。
3. 内容准确。

## SOUL 草稿要素

| Field | Value |
|---|---|
| name | 客户交付助手 |
| role | 读取客户 intake 并生成交付配置。 |
| tone | 专业、清晰、审慎。 |
| forbidden | 泄密 / 越权 / 未授权外发 |
`) {
    const vaultDir = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault')
    await mkdir(vaultDir, { recursive: true })
    await writeFile(path.join(vaultDir, 'intake-analysis.md'), content, 'utf8')
  }

  beforeEach(async () => {
    harnessRoot = await mkdtempCompat('mc-ob-s5-')
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

  it('lets an admin generate mock SOUL/AGENTS with zero placeholders', async () => {
    await writeAnalysis()
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('mock-fallback')
    expect(body.provider).toBe('mock')
    expect(body.unresolved_placeholders).toEqual([])
    expect(body.paths.soul).toBe('phase0/tenants/demo-dry-run-2/vault/Agent-Main/SOUL.md')
    expect(body.paths.agents).toBe('phase0/tenants/demo-dry-run-2/vault/Agent-Main/AGENTS.md')
    await expect(stat(path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/vault/Agent-Main/SOUL.md'))).resolves.toBeTruthy()
    await expect(stat(path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/vault/Agent-Main/AGENTS.md'))).resolves.toBeTruthy()
  })

  it('uses Anthropic LLM mode when ANTHROPIC_API_KEY is configured', async () => {
    await writeAnalysis()
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(llmDraft()) }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('llm-anthropic')
    expect(body.provider).toBe('anthropic')
    expect(body.content.soul).toContain('客户分析助手')
    expect(body.content.soul).not.toContain('sk-ant-test-secret')
    const fetchCalls = fetchMock.mock.calls as unknown[][]
    expect(fetchCalls[0]?.[0]).toBe('https://api.anthropic.com/v1/messages')
  })

  it('uses OpenAI LLM mode when only OPENAI_API_KEY is configured', async () => {
    await writeAnalysis()
    process.env.OPENAI_API_KEY = 'sk-test-openai-secret'
    const openAiDraft = llmDraft(' OpenAI')
    openAiDraft.soul_md = openAiDraft.soul_md.replace('llm-anthropic', 'llm-openai').replace('anthropic', 'openai')
    openAiDraft.agents_md = openAiDraft.agents_md.replace('llm-anthropic', 'llm-openai').replace('anthropic', 'openai')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(openAiDraft) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('llm-openai')
    expect(body.provider).toBe('openai')
    expect(body.content.agents).toContain('OpenAI')
    expect(body.content.agents).not.toContain('sk-test-openai-secret')
    const fetchCalls = fetchMock.mock.calls as unknown[][]
    expect(fetchCalls[0]?.[0]).toBe('https://api.openai.com/v1/chat/completions')
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

  it('returns a clear error when intake-analysis.md is missing', async () => {
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('vault/intake-analysis.md is required')
  })

  it('is idempotent and does not overwrite existing SOUL/AGENTS', async () => {
    await writeAnalysis()
    const agentMain = path.join(harnessRoot, 'phase0/tenants', tenantId, 'vault/Agent-Main')
    await mkdir(agentMain, { recursive: true })
    const existingSoul = '# SOUL\n\n> Mode: mock-fallback\n\nexisting soul\n'
    const existingAgents = '# AGENTS\n\n> Mode: mock-fallback\n\nexisting agents\n'
    await writeFile(path.join(agentMain, 'SOUL.md'), existingSoul, 'utf8')
    await writeFile(path.join(agentMain, 'AGENTS.md'), existingAgents, 'utf8')

    const { POST } = await loadRoute()
    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.already_exists).toBe(true)
    expect(body.content.soul).toBe(existingSoul)
    expect(body.content.agents).toBe(existingAgents)
    await expect(readFile(path.join(agentMain, 'SOUL.md'), 'utf8')).resolves.toBe(existingSoul)
  })

  it('falls back gracefully when LLM fails without exposing API keys', async () => {
    await writeAnalysis()
    process.env.OPENAI_API_KEY = 'sk-test-openai-secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream failed', { status: 500 })))
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('mock-fallback')
    expect(body.provider).toBe('mock')
    expect(body.content.soul).not.toContain('sk-test-openai-secret')
    expect(body.content.agents).not.toContain('sk-test-openai-secret')
  })

  it('detects unresolved placeholders', () => {
    expect(detectUnresolvedPlaceholders('# SOUL\n{{TEST}}')).toEqual(['TEST'])
  })

  it('detects provider priority as Anthropic before OpenAI', () => {
    expect(selectCustomerSoulProvider({
      ANTHROPIC_API_KEY: 'anthropic-key',
      OPENAI_API_KEY: 'openai-key',
    } as unknown as NodeJS.ProcessEnv)).toBe('anthropic')
    expect(selectCustomerSoulProvider({
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: 'openai-key',
    } as unknown as NodeJS.ProcessEnv)).toBe('openai')
    expect(selectCustomerSoulProvider({} as unknown as NodeJS.ProcessEnv)).toBeNull()
  })

  it('writes the required mock content structure', async () => {
    await writeAnalysis()
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant_id: tenantId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.content.soul).toContain('## 角色定义')
    expect(body.content.soul).toContain('## 工作原则')
    expect(body.content.soul).toContain('## 禁止行为')
    expect(body.content.soul).toContain('客户交付助手')
    expect(body.content.soul).toContain('泄密 / 越权 / 未授权外发')
    expect(body.content.agents).toContain('## Agent-Main')
    expect(body.content.agents).toContain('## Skills')
    expect(body.content.agents).toContain('- media-monitor')
    expect(body.content.agents).toContain('- data-aggregator')
    expect(body.diff_vs_template.soul).toContain('+')
    expect(body.content_hashes.soul).toMatch(/^[a-f0-9]{64}$/)
    expect(body.content_hashes.agents).toMatch(/^[a-f0-9]{64}$/)
  })
})

async function mkdtempCompat(prefix: string) {
  const { mkdtemp } = await import('node:fs/promises')
  return mkdtemp(path.join(os.tmpdir(), prefix))
}
