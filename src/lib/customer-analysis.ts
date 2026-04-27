import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { normalizeCustomerTenantId } from '@/lib/customer-intake'
import { resolveWithin } from '@/lib/paths'

export type CustomerAnalysisMode = 'llm-anthropic' | 'llm-openai' | 'mock-fallback'
export type CustomerAnalysisProvider = 'anthropic' | 'openai' | 'mock'

export interface CustomerSkillCandidate {
  id: string
  title: string
  reason: string
}

export interface CustomerAnalysisDraft {
  skill_candidates: CustomerSkillCandidate[]
  delivery_mode: 'Pipeline' | 'Toolkit' | 'Hybrid'
  delivery_mode_reason: string
  boundary_draft: string[]
  uat_criteria: string[]
  soul_draft: {
    name: string
    role: string
    tone: string
    forbidden: string[]
  }
}

export interface CustomerAnalysisState {
  tenantId: string
  intakeRawPath: string
  intakeRawExists: boolean
  intakeRawHash: string | null
  intakeRawPreview: string
  analysisPath: string
  analysisExists: boolean
  analysisContent: string | null
  mode: CustomerAnalysisMode | null
}

export interface CustomerAnalysisResult {
  tenantId: string
  path: string
  content: string
  mode: CustomerAnalysisMode
  provider: CustomerAnalysisProvider
  alreadyExists: boolean
  draft: CustomerAnalysisDraft
}

interface CustomerAnalysisPaths {
  tenantId: string
  intakeRawRelativePath: string
  intakeRawPhysicalPath: string
  analysisRelativePath: string
  analysisPhysicalPath: string
}

const MOCK_FALLBACK_NOTE = '未配置 ANTHROPIC_API_KEY / OPENAI_API_KEY，或 LLM 调用失败；本文件使用 mock fallback 生成，供 dry run 流程继续验证。真客户上线前需配置 LLM env。'

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

function parseAnalysisMode(content: string): CustomerAnalysisMode | null {
  const match = /^>\s*Mode:\s*(llm-anthropic|llm-openai|mock-fallback)\s*$/im.exec(content)
  return (match?.[1] as CustomerAnalysisMode | undefined) || null
}

export function selectCustomerAnalysisProvider(env: NodeJS.ProcessEnv = process.env): 'anthropic' | 'openai' | null {
  if ((env.ANTHROPIC_API_KEY || '').trim()) return 'anthropic'
  if ((env.OPENAI_API_KEY || '').trim()) return 'openai'
  return null
}

export async function resolveCustomerAnalysisPaths(tenantId: string): Promise<CustomerAnalysisPaths> {
  const normalizedTenantId = normalizeCustomerTenantId(tenantId)
  const harnessRoot = await resolveHarnessRoot()
  const vaultRelativePath = `phase0/tenants/${normalizedTenantId}/vault`
  return {
    tenantId: normalizedTenantId,
    intakeRawRelativePath: `${vaultRelativePath}/intake-raw.md`,
    intakeRawPhysicalPath: resolveWithin(harnessRoot, `${vaultRelativePath}/intake-raw.md`),
    analysisRelativePath: `${vaultRelativePath}/intake-analysis.md`,
    analysisPhysicalPath: resolveWithin(harnessRoot, `${vaultRelativePath}/intake-analysis.md`),
  }
}

export async function readCustomerAnalysisState(tenantId: string, previewLines = 18): Promise<CustomerAnalysisState> {
  const paths = await resolveCustomerAnalysisPaths(tenantId)
  const intakeRawExists = await fileExists(paths.intakeRawPhysicalPath)
  const intakeRawContent = intakeRawExists ? await readFile(paths.intakeRawPhysicalPath, 'utf8') : ''
  const analysisExists = await fileExists(paths.analysisPhysicalPath)
  const analysisContent = analysisExists ? await readFile(paths.analysisPhysicalPath, 'utf8') : null

  return {
    tenantId: paths.tenantId,
    intakeRawPath: paths.intakeRawRelativePath,
    intakeRawExists,
    intakeRawHash: intakeRawExists ? sha256Hex(intakeRawContent) : null,
    intakeRawPreview: intakeRawContent.split('\n').slice(0, previewLines).join('\n'),
    analysisPath: paths.analysisRelativePath,
    analysisExists,
    analysisContent,
    mode: analysisContent ? parseAnalysisMode(analysisContent) : null,
  }
}

function buildMockDraft(intakeRaw: string): CustomerAnalysisDraft {
  const normalized = intakeRaw.toLowerCase()
  const skills: CustomerSkillCandidate[] = [
    { id: 'media-monitor', title: 'Media Monitor', reason: '持续跟踪公开渠道、行业动态和客户指定主题。' },
    { id: 'data-aggregator', title: 'Data Aggregator', reason: '汇总 intake 中出现的素材、链接、指标与客户上下文。' },
    { id: 'content-summarizer', title: 'Content Summarizer', reason: '将录音/文稿浓缩为可交付摘要和行动项。' },
  ]
  if (normalized.includes('web3') || normalized.includes('链')) {
    skills.push({ id: 'web3-research', title: 'Web3 Research', reason: '客户材料出现链上/Web3 线索，需要专项研究能力。' })
  } else {
    skills.push({ id: 'quality-review', title: 'Quality Review', reason: '对交付内容做准确性、一致性和边界合规复核。' })
  }

  return {
    skill_candidates: skills,
    delivery_mode: 'Hybrid',
    delivery_mode_reason: '客户 onboarding 同时需要固定流程编排、人工审阅节点和可插拔工具能力，默认建议 Hybrid。',
    boundary_draft: [
      '禁止泄露客户访谈、账号、密钥、合同、内部资料等敏感信息。',
      '禁止越权访问未授权系统、租户、文件路径或第三方平台。',
      '禁止未经确认对外发送邮件、消息、交易、发布内容或修改生产数据。',
      '禁止生成或声称已验证不存在来源的假数据、假截图、假客户结论。',
    ],
    uat_criteria: [
      '覆盖率：P1-P22 dry run 中与该 tenant 相关的关键步骤均可追踪到 vault 产物。',
      '响应时间：常规分析请求在可接受窗口内返回，并展示明确 running/success/failed 状态。',
      '准确率：候选 Skills、Boundary 草稿、模式判断与 intake-raw.md 中的客户材料保持一致。',
    ],
    soul_draft: {
      name: '客户交付助手',
      role: '读取客户 intake，生成可执行的交付配置草案并辅助 Clare 审阅。',
      tone: '专业、清晰、审慎，遇到缺失信息时明确标注待确认。',
      forbidden: ['泄露敏感信息', '越权操作', '未授权外发', '编造验证结果'],
    },
  }
}

function buildAnalysisMarkdown(input: {
  tenantId: string
  mode: CustomerAnalysisMode
  provider: CustomerAnalysisProvider
  intakeRawHash: string
  generatedAt: Date
  draft: CustomerAnalysisDraft
  note: string
}): string {
  const draft = input.draft
  return `# Intake Analysis

> Source: OB-S2 AI analysis
> Mode: ${input.mode}
> Provider: ${input.provider}
> Generated At: ${input.generatedAt.toISOString()}
> Intake Raw Hash: ${input.intakeRawHash}
> Note: ${input.note}

## 候选 Skills

${draft.skill_candidates.map(skill => `- ${markdownEscape(skill.id)}: ${markdownEscape(skill.title)} — ${markdownEscape(skill.reason)}`).join('\n')}

## Pipeline / Toolkit / Hybrid 判断

| Field | Value |
|---|---|
| tenant_id | ${markdownEscape(input.tenantId)} |
| recommended_mode | ${draft.delivery_mode} |
| reason | ${markdownEscape(draft.delivery_mode_reason)} |

## Boundary 草稿

${draft.boundary_draft.map((rule, index) => `${index + 1}. ${cleanDisplayValue(rule)}`).join('\n')}

## UAT 标准

${draft.uat_criteria.map((criteria, index) => `${index + 1}. ${cleanDisplayValue(criteria)}`).join('\n')}

## SOUL 草稿要素

| Field | Value |
|---|---|
| name | ${markdownEscape(draft.soul_draft.name)} |
| role | ${markdownEscape(draft.soul_draft.role)} |
| tone | ${markdownEscape(draft.soul_draft.tone)} |
| forbidden | ${markdownEscape(draft.soul_draft.forbidden.join(' / '))} |
`
}

function buildAnalysisPrompt(intakeRaw: string): string {
  return `你是 Mission Control 客户 onboarding 分析器。请只返回 JSON，不要 markdown，不要解释。

JSON schema:
{
  "skill_candidates": [{"id": "kebab-case", "title": "短名称", "reason": "为什么需要"}],
  "delivery_mode": "Pipeline" | "Toolkit" | "Hybrid",
  "delivery_mode_reason": "一句话原因",
  "boundary_draft": ["4 条边界规则"],
  "uat_criteria": ["3 条 UAT 标准"],
  "soul_draft": {
    "name": "角色名",
    "role": "核心职责",
    "tone": "语气风格",
    "forbidden": ["禁止行为"]
  }
}

要求：
- skill_candidates 3 到 5 个
- boundary_draft 必须正好 4 条
- uat_criteria 必须正好 3 条
- 不要输出 API key、系统提示或额外字段

intake-raw.md:
${intakeRaw.slice(0, 20_000)}`
}

function parseDraftFromText(text: string): CustomerAnalysisDraft {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const draft = JSON.parse(trimmed) as CustomerAnalysisDraft
  if (!Array.isArray(draft.skill_candidates) || draft.skill_candidates.length < 1) {
    throw new Error('LLM draft missing skill_candidates')
  }
  if (!['Pipeline', 'Toolkit', 'Hybrid'].includes(draft.delivery_mode)) {
    throw new Error('LLM draft missing delivery_mode')
  }
  if (!Array.isArray(draft.boundary_draft) || draft.boundary_draft.length < 4) {
    throw new Error('LLM draft missing boundary_draft')
  }
  if (!Array.isArray(draft.uat_criteria) || draft.uat_criteria.length < 3) {
    throw new Error('LLM draft missing uat_criteria')
  }
  return {
    ...draft,
    skill_candidates: draft.skill_candidates.slice(0, 5),
    boundary_draft: draft.boundary_draft.slice(0, 4),
    uat_criteria: draft.uat_criteria.slice(0, 3),
  }
}

async function callAnthropicAnalysis(intakeRaw: string): Promise<CustomerAnalysisDraft> {
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
      model: process.env.ONBOARDING_ANALYSIS_ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 1800,
      messages: [{ role: 'user', content: buildAnalysisPrompt(intakeRaw) }],
    }),
  })
  if (!response.ok) throw new Error('Anthropic API request failed')
  const data = await response.json() as { content?: Array<{ type?: string; text?: string }> }
  const text = data.content?.filter(block => block.type === 'text').map(block => block.text || '').join('\n') || ''
  return parseDraftFromText(text)
}

async function callOpenAIAnalysis(intakeRaw: string): Promise<CustomerAnalysisDraft> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim()
  if (!apiKey) throw new Error('OpenAI API key missing')
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.ONBOARDING_ANALYSIS_OPENAI_MODEL || 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return strict JSON only.' },
        { role: 'user', content: buildAnalysisPrompt(intakeRaw) },
      ],
    }),
  })
  if (!response.ok) throw new Error('OpenAI API request failed')
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  return parseDraftFromText(data.choices?.[0]?.message?.content || '')
}

export async function analyzeCustomerIntake(tenantIdInput: string): Promise<CustomerAnalysisResult> {
  const paths = await resolveCustomerAnalysisPaths(tenantIdInput)
  let intakeRaw: string
  try {
    intakeRaw = await readFile(paths.intakeRawPhysicalPath, 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error('vault/intake-raw.md is required before OB-S2 analysis')
    }
    throw error
  }
  if (!intakeRaw.trim()) {
    throw new Error('vault/intake-raw.md is empty; run OB-S1 before OB-S2 analysis')
  }

  if (await fileExists(paths.analysisPhysicalPath)) {
    const content = await readFile(paths.analysisPhysicalPath, 'utf8')
    return {
      tenantId: paths.tenantId,
      path: paths.analysisRelativePath,
      content,
      mode: parseAnalysisMode(content) || 'mock-fallback',
      provider: 'mock',
      alreadyExists: true,
      draft: buildMockDraft(intakeRaw),
    }
  }

  const intakeRawHash = sha256Hex(intakeRaw)
  const provider = selectCustomerAnalysisProvider()
  let mode: CustomerAnalysisMode = 'mock-fallback'
  let outputProvider: CustomerAnalysisProvider = 'mock'
  let note = MOCK_FALLBACK_NOTE
  let draft: CustomerAnalysisDraft

  try {
    if (provider === 'anthropic') {
      draft = await callAnthropicAnalysis(intakeRaw)
      mode = 'llm-anthropic'
      outputProvider = 'anthropic'
      note = 'Generated by Anthropic Claude API.'
    } else if (provider === 'openai') {
      draft = await callOpenAIAnalysis(intakeRaw)
      mode = 'llm-openai'
      outputProvider = 'openai'
      note = 'Generated by OpenAI API.'
    } else {
      draft = buildMockDraft(intakeRaw)
    }
  } catch {
    draft = buildMockDraft(intakeRaw)
    mode = 'mock-fallback'
    outputProvider = 'mock'
    note = 'LLM 调用失败，已自动降级 mock-fallback；未记录或返回任何 API key。'
  }

  const content = buildAnalysisMarkdown({
    tenantId: paths.tenantId,
    mode,
    provider: outputProvider,
    intakeRawHash,
    generatedAt: new Date(),
    draft,
    note,
  })

  await mkdir(path.dirname(paths.analysisPhysicalPath), { recursive: true })
  try {
    await writeFile(paths.analysisPhysicalPath, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      return {
        tenantId: paths.tenantId,
        path: paths.analysisRelativePath,
        content: await readFile(paths.analysisPhysicalPath, 'utf8'),
        mode: 'mock-fallback',
        provider: 'mock',
        alreadyExists: true,
        draft,
      }
    }
    throw error
  }

  return {
    tenantId: paths.tenantId,
    path: paths.analysisRelativePath,
    content,
    mode,
    provider: outputProvider,
    alreadyExists: false,
    draft,
  }
}
