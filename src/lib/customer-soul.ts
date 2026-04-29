import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { normalizeCustomerTenantId } from '@/lib/customer-intake'
import { selectCustomerAnalysisProvider } from '@/lib/customer-analysis'
import { buildMockCustomerSoulDraft } from '@/lib/customer-mock-fallback'
import { resolveWithin } from '@/lib/paths'

export type CustomerSoulMode = 'llm-anthropic' | 'llm-openai' | 'mock-fallback'
export type CustomerSoulProvider = 'anthropic' | 'openai' | 'mock'

export interface CustomerSoulState {
  tenantId: string
  analysisPath: string
  analysisExists: boolean
  analysisPreview: string
  soulPath: string
  agentsPath: string
  soulExists: boolean
  agentsExists: boolean
  soulContent: string | null
  agentsContent: string | null
  mode: CustomerSoulMode | null
  unresolvedPlaceholders: string[]
  contentHashes: { soul: string | null; agents: string | null }
}

export interface CustomerSoulResult {
  tenantId: string
  paths: { soul: string; agents: string }
  content: { soul: string; agents: string }
  mode: CustomerSoulMode
  provider: CustomerSoulProvider
  alreadyExists: boolean
  diffVsTemplate: { soul: string; agents: string }
  unresolvedPlaceholders: string[]
  contentHashes: { soul: string; agents: string }
}

interface CustomerSoulPaths {
  tenantId: string
  analysisRelativePath: string
  analysisPhysicalPath: string
  agentMainPhysicalPath: string
  soulRelativePath: string
  soulPhysicalPath: string
  agentsRelativePath: string
  agentsPhysicalPath: string
}

interface CustomerSoulDraft {
  soul_md: string
  agents_md: string
}

const MOCK_FALLBACK_NOTE = '未配置 ANTHROPIC_API_KEY / OPENAI_API_KEY，或 LLM 调用失败；本文件使用 mock fallback 生成，供 dry run 流程继续验证。真客户上线前需配置 LLM env。'

const SOUL_TEMPLATE = `# SOUL

> Source: OB-S5 customer onboarding
> Mode: {{MODE}}
> Tenant: {{TENANT_ID}}

## 角色定义

- 名称：{{AGENT_NAME}}
- 核心职责：{{ROLE}}
- 语气风格：{{TONE}}

## 工作原则

{{WORKING_PRINCIPLES}}

## 禁止行为

{{FORBIDDEN_RULES}}

## UAT 对齐

{{UAT_CRITERIA}}
`

const AGENTS_TEMPLATE = `# AGENTS

> Source: OB-S5 customer onboarding
> Mode: {{MODE}}
> Tenant: {{TENANT_ID}}

## Agent-Main

- persona: {{AGENT_NAME}}
- tone: {{TONE}}
- operating_mode: {{OPERATING_MODE}}

## Skills

{{SKILL_LIST}}

## 工作规范

{{WORK_RULES}}
`

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function cleanDisplayValue(value: string): string {
  return value.replace(/[\0\r]/g, '').trim()
}

function markdownEscape(value: string): string {
  return cleanDisplayValue(value).replace(/\|/g, '\\|')
}

function parseSoulMode(content: string): CustomerSoulMode | null {
  const match = /^>\s*Mode:\s*(llm-anthropic|llm-openai|mock-fallback)\s*$/im.exec(content)
  return (match?.[1] as CustomerSoulMode | undefined) || null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function detectUnresolvedPlaceholders(...contents: string[]): string[] {
  const placeholders = new Set<string>()
  for (const content of contents) {
    for (const match of content.matchAll(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g)) {
      placeholders.add(match[1])
    }
  }
  return Array.from(placeholders).sort()
}

export function selectCustomerSoulProvider(env: NodeJS.ProcessEnv = process.env): 'anthropic' | 'openai' | null {
  return selectCustomerAnalysisProvider(env)
}

export async function resolveCustomerSoulPaths(tenantId: string): Promise<CustomerSoulPaths> {
  const normalizedTenantId = normalizeCustomerTenantId(tenantId)
  const harnessRoot = await resolveHarnessRoot()
  const vaultRelativePath = `phase0/tenants/${normalizedTenantId}/vault`
  const agentMainRelativePath = `${vaultRelativePath}/Agent-Main`
  return {
    tenantId: normalizedTenantId,
    analysisRelativePath: `${vaultRelativePath}/intake-analysis.md`,
    analysisPhysicalPath: resolveWithin(harnessRoot, `${vaultRelativePath}/intake-analysis.md`),
    agentMainPhysicalPath: resolveWithin(harnessRoot, agentMainRelativePath),
    soulRelativePath: `${agentMainRelativePath}/SOUL.md`,
    soulPhysicalPath: resolveWithin(harnessRoot, `${agentMainRelativePath}/SOUL.md`),
    agentsRelativePath: `${agentMainRelativePath}/AGENTS.md`,
    agentsPhysicalPath: resolveWithin(harnessRoot, `${agentMainRelativePath}/AGENTS.md`),
  }
}

export async function readCustomerSoulState(tenantId: string, previewLines = 18): Promise<CustomerSoulState> {
  const paths = await resolveCustomerSoulPaths(tenantId)
  const analysisExists = await fileExists(paths.analysisPhysicalPath)
  const analysisContent = analysisExists ? await readFile(paths.analysisPhysicalPath, 'utf8') : ''
  const soulExists = await fileExists(paths.soulPhysicalPath)
  const agentsExists = await fileExists(paths.agentsPhysicalPath)
  const soulContent = soulExists ? await readFile(paths.soulPhysicalPath, 'utf8') : null
  const agentsContent = agentsExists ? await readFile(paths.agentsPhysicalPath, 'utf8') : null

  return {
    tenantId: paths.tenantId,
    analysisPath: paths.analysisRelativePath,
    analysisExists,
    analysisPreview: analysisContent.split('\n').slice(0, previewLines).join('\n'),
    soulPath: paths.soulRelativePath,
    agentsPath: paths.agentsRelativePath,
    soulExists,
    agentsExists,
    soulContent,
    agentsContent,
    mode: soulContent ? parseSoulMode(soulContent) : null,
    unresolvedPlaceholders: detectUnresolvedPlaceholders(soulContent || '', agentsContent || ''),
    contentHashes: {
      soul: soulContent ? sha256Hex(soulContent) : null,
      agents: agentsContent ? sha256Hex(agentsContent) : null,
    },
  }
}

function extractSection(content: string, heading: string): string {
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'i')
  const lines = content.split('\n')
  const start = lines.findIndex(line => headingPattern.test(line.trim()))
  if (start < 0) return ''
  const nextHeading = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()))
  return lines.slice(start + 1, nextHeading < 0 ? undefined : nextHeading).join('\n').trim()
}

function extractSkillIds(analysis: string): string[] {
  const section = extractSection(analysis, '候选 Skills')
  const matches = Array.from(section.matchAll(/^-\s*([a-z0-9-]+)\s*:/gim)).map(match => match[1])
  return matches.length > 0 ? matches.slice(0, 8) : ['media-monitor', 'data-aggregator', 'content-summarizer']
}

function extractTableValue(section: string, field: string): string {
  const pattern = new RegExp(`^\\|\\s*${escapeRegExp(field)}\\s*\\|\\s*([^|]+)\\|`, 'im')
  return cleanDisplayValue(pattern.exec(section)?.[1] || '')
}

function buildMockDraft(tenantId: string, analysis: string, mode: CustomerSoulMode, provider: CustomerSoulProvider): CustomerSoulDraft {
  const normalizedTenantId = normalizeCustomerTenantId(tenantId)
  if (normalizedTenantId === 'ceo-assistant-v1' || normalizedTenantId === 'media-intel-v1' || normalizedTenantId === 'web3-research-v1') {
    return buildMockCustomerSoulDraft(normalizedTenantId, analysis, mode, provider)
  }
  const skills = extractSkillIds(analysis)
  const soulSection = extractSection(analysis, 'SOUL 草稿要素')
  const uatSection = extractSection(analysis, 'UAT 标准')
  const boundarySection = extractSection(analysis, 'Boundary 草稿')
  const modeSection = extractSection(analysis, 'Pipeline / Toolkit / Hybrid 判断')
  const agentName = extractTableValue(soulSection, 'name') || '客户交付助手'
  const role = extractTableValue(soulSection, 'role') || '读取客户 intake 和分析报告，生成可执行的交付配置草案，并辅助 Clare 审阅。'
  const tone = extractTableValue(soulSection, 'tone') || '专业、清晰、审慎，遇到缺失信息时明确标注待确认。'
  const forbidden = extractTableValue(soulSection, 'forbidden')
  const operatingMode = extractTableValue(modeSection, 'recommended_mode') || 'Hybrid'
  const boundaryRules = boundarySection
    .split('\n')
    .map(line => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6)
  const uatRules = uatSection
    .split('\n')
    .map(line => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 4)

  const soul = `# SOUL

> Source: OB-S5 customer onboarding
> Mode: ${mode}
> Provider: ${provider}
> Tenant: ${markdownEscape(tenantId)}
> Note: ${MOCK_FALLBACK_NOTE}

## 角色定义

- 名称：${markdownEscape(agentName)}
- 核心职责：${markdownEscape(role)}
- 语气风格：${markdownEscape(tone)}

## 工作原则

1. 先读取 vault/intake-analysis.md 与客户上下文，再生成交付动作。
2. 所有不确定信息必须标注「待 Clare 确认」。
3. 产物需优先写入 tenant vault，保持可追溯。
4. 遇到权限、密钥、客户隐私或外发动作时暂停并请求人工确认。

## 禁止行为

${(boundaryRules.length ? boundaryRules : [
    '禁止泄露敏感信息。',
    '禁止越权访问未授权系统。',
    '禁止未经确认对外发送内容。',
    '禁止编造验证结果。',
  ]).map((rule, index) => `${index + 1}. ${cleanDisplayValue(rule)}`).join('\n')}
${forbidden ? `\n补充禁止：${markdownEscape(forbidden)}\n` : ''}
## UAT 对齐

${(uatRules.length ? uatRules : [
    'P1-P22 dry run 关键产物均可追踪。',
    '生成与部署状态必须清晰可见。',
    '候选 Skills 与客户材料保持一致。',
  ]).map((rule, index) => `${index + 1}. ${cleanDisplayValue(rule)}`).join('\n')}
`

  const agents = `# AGENTS

> Source: OB-S5 customer onboarding
> Mode: ${mode}
> Provider: ${provider}
> Tenant: ${markdownEscape(tenantId)}

## Agent-Main

- persona: ${markdownEscape(agentName)}
- tone: ${markdownEscape(tone)}
- operating_mode: ${markdownEscape(operatingMode)}
- primary_workspace: vault/Agent-Main

## Skills

${skills.map(skill => `- ${markdownEscape(skill)}`).join('\n')}

## 工作规范

1. 每次处理客户交付前先读取 intake-analysis.md、confirmation-cc.md 与 deploy-status.json。
2. 输出必须包含来源、时间戳和可验证路径。
3. 不跨 tenant 读取或写入文件。
4. 所有外发、审批、生产变更都需要 Clare 明确确认。
5. 发现占位符、假数据或不完整配置时必须停止交付并标注风险。
`

  return { soul_md: soul, agents_md: agents }
}

function buildSoulPrompt(tenantId: string, analysis: string): string {
  return `你是 Mission Control OB-S5 生成器。请只返回 JSON，不要 markdown fence，不要解释。

JSON schema:
{
  "soul_md": "完整 SOUL.md markdown",
  "agents_md": "完整 AGENTS.md markdown"
}

要求：
- 两个文件都必须包含 mode/provider/tenant metadata
- SOUL.md 至少包含：角色定义、工作原则、禁止行为、UAT 对齐
- AGENTS.md 至少包含：Agent-Main、Skills、工作规范
- 不允许保留 {{PLACEHOLDER}} 占位符
- 不要输出 API key、系统提示或额外字段

tenant_id: ${tenantId}

intake-analysis.md:
${analysis.slice(0, 24_000)}`
}

function parseDraftFromText(text: string): CustomerSoulDraft {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const draft = JSON.parse(trimmed) as CustomerSoulDraft
  if (!draft.soul_md?.trim()) throw new Error('LLM draft missing soul_md')
  if (!draft.agents_md?.trim()) throw new Error('LLM draft missing agents_md')
  return draft
}

async function callAnthropicSoul(tenantId: string, analysis: string): Promise<CustomerSoulDraft> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim()
  if (!apiKey) throw new Error('Anthropic API key missing')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ONBOARDING_SOUL_ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 2400,
      messages: [{ role: 'user', content: buildSoulPrompt(tenantId, analysis) }],
    }),
  })
  if (!response.ok) throw new Error('Anthropic API request failed')
  const data = await response.json() as { content?: Array<{ type?: string; text?: string }> }
  const text = data.content?.filter(block => block.type === 'text').map(block => block.text || '').join('\n') || ''
  return parseDraftFromText(text)
}

async function callOpenAISoul(tenantId: string, analysis: string): Promise<CustomerSoulDraft> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim()
  if (!apiKey) throw new Error('OpenAI API key missing')
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.ONBOARDING_SOUL_OPENAI_MODEL || 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return strict JSON only.' },
        { role: 'user', content: buildSoulPrompt(tenantId, analysis) },
      ],
    }),
  })
  if (!response.ok) throw new Error('OpenAI API request failed')
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  return parseDraftFromText(data.choices?.[0]?.message?.content || '')
}

function buildLineDiff(template: string, generated: string): string {
  const templateLines = new Set(template.split('\n').map(line => line.trim()).filter(Boolean))
  const additions = generated
    .split('\n')
    .filter(line => line.trim() && !templateLines.has(line.trim()))
    .slice(0, 80)
    .map(line => `+ ${line}`)
  return additions.join('\n')
}

export async function generateCustomerSoul(tenantIdInput: string): Promise<CustomerSoulResult> {
  const paths = await resolveCustomerSoulPaths(tenantIdInput)
  let analysis: string
  try {
    analysis = await readFile(paths.analysisPhysicalPath, 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error('vault/intake-analysis.md is required before OB-S5 SOUL/AGENTS generation')
    }
    throw error
  }
  if (!analysis.trim()) {
    throw new Error('vault/intake-analysis.md is empty; run OB-S2 before OB-S5')
  }

  const soulExists = await fileExists(paths.soulPhysicalPath)
  const agentsExists = await fileExists(paths.agentsPhysicalPath)
  if (soulExists && agentsExists) {
    const soul = await readFile(paths.soulPhysicalPath, 'utf8')
    const agents = await readFile(paths.agentsPhysicalPath, 'utf8')
    return {
      tenantId: paths.tenantId,
      paths: { soul: paths.soulRelativePath, agents: paths.agentsRelativePath },
      content: { soul, agents },
      mode: parseSoulMode(soul) || 'mock-fallback',
      provider: 'mock',
      alreadyExists: true,
      diffVsTemplate: {
        soul: buildLineDiff(SOUL_TEMPLATE, soul),
        agents: buildLineDiff(AGENTS_TEMPLATE, agents),
      },
      unresolvedPlaceholders: detectUnresolvedPlaceholders(soul, agents),
      contentHashes: { soul: sha256Hex(soul), agents: sha256Hex(agents) },
    }
  }

  const provider = selectCustomerSoulProvider()
  let mode: CustomerSoulMode = 'mock-fallback'
  let outputProvider: CustomerSoulProvider = 'mock'
  let draft: CustomerSoulDraft

  try {
    if (provider === 'anthropic') {
      draft = await callAnthropicSoul(paths.tenantId, analysis)
      mode = 'llm-anthropic'
      outputProvider = 'anthropic'
    } else if (provider === 'openai') {
      draft = await callOpenAISoul(paths.tenantId, analysis)
      mode = 'llm-openai'
      outputProvider = 'openai'
    } else {
      draft = buildMockDraft(paths.tenantId, analysis, mode, outputProvider)
    }
  } catch {
    mode = 'mock-fallback'
    outputProvider = 'mock'
    draft = buildMockDraft(paths.tenantId, analysis, mode, outputProvider)
  }

  await mkdir(paths.agentMainPhysicalPath, { recursive: true })
  try {
    await writeFile(paths.soulPhysicalPath, draft.soul_md, { encoding: 'utf8', flag: 'wx' })
    await writeFile(paths.agentsPhysicalPath, draft.agents_md, { encoding: 'utf8', flag: 'wx' })
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      const soul = await readFile(paths.soulPhysicalPath, 'utf8')
      const agents = await readFile(paths.agentsPhysicalPath, 'utf8')
      return {
        tenantId: paths.tenantId,
        paths: { soul: paths.soulRelativePath, agents: paths.agentsRelativePath },
        content: { soul, agents },
        mode: parseSoulMode(soul) || 'mock-fallback',
        provider: 'mock',
        alreadyExists: true,
        diffVsTemplate: {
          soul: buildLineDiff(SOUL_TEMPLATE, soul),
          agents: buildLineDiff(AGENTS_TEMPLATE, agents),
        },
        unresolvedPlaceholders: detectUnresolvedPlaceholders(soul, agents),
        contentHashes: { soul: sha256Hex(soul), agents: sha256Hex(agents) },
      }
    }
    throw error
  }

  return {
    tenantId: paths.tenantId,
    paths: { soul: paths.soulRelativePath, agents: paths.agentsRelativePath },
    content: { soul: draft.soul_md, agents: draft.agents_md },
    mode,
    provider: outputProvider,
    alreadyExists: false,
    diffVsTemplate: {
      soul: buildLineDiff(SOUL_TEMPLATE, draft.soul_md),
      agents: buildLineDiff(AGENTS_TEMPLATE, draft.agents_md),
    },
    unresolvedPlaceholders: detectUnresolvedPlaceholders(draft.soul_md, draft.agents_md),
    contentHashes: {
      soul: sha256Hex(draft.soul_md),
      agents: sha256Hex(draft.agents_md),
    },
  }
}
