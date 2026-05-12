import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { normalizeCustomerTenantId } from '@/lib/customer-intake'
import { resolveWithin } from '@/lib/paths'
import { buildCustomerBoundaryRulesDraft, buildCustomerSkillsBlueprint, buildCustomerUatDraft } from '@/lib/customer-blueprint'
import { buildMockCustomerAnalysisDraft } from '@/lib/customer-mock-fallback'

export type CustomerAnalysisMode = 'llm-anthropic' | 'llm-openai' | 'mock-fallback'
export type CustomerAnalysisProvider = 'anthropic' | 'openai' | 'mock'

export interface CustomerSkillCandidate {
  id: string
  title: string
  order: number
  workflow_stage: string
  inputs: string[]
  outputs: string[]
  handoff: string
  human_confirmation: string
  reason: string
}

export interface CustomerWorkflowStep {
  order: number
  name: string
  actor: string
  trigger: string
  output: string
  next: string
}

export interface CustomerAnalysisDraft {
  workflow_steps: CustomerWorkflowStep[]
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
  agents_draft: {
    session_protocol: string[]
    memory_system: any
    workflow_steps_detailed: any[]
    skill_dispatch_rules: any
    progress_save: any
    workspace_files: string[]
    vault_structure: any
  } | null
}

export interface VaultFileInfo {
  name: string
  exists: boolean
  content: string | null
}

export interface VaultDirInfo {
  path: string
  exists: boolean
  children: string[]
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
  analysisIntakeRawHash: string | null
  analysisMatchesIntake: boolean | null
  draft: CustomerAnalysisDraft | null
  userMd: VaultFileInfo | null
  identityMd: VaultFileInfo | null
  vaultIndexMd: VaultFileInfo | null
  vaultDirs: VaultDirInfo[]
  templateFiles: VaultFileInfo[]
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
const GENERIC_DEMO_SKILL_IDS = ['media-monitor', 'data-aggregator', 'content-summarizer']

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

function parseAnalysisProvider(content: string): CustomerAnalysisProvider {
  const match = /^>\s*Provider:\s*(anthropic|openai|mock)\s*$/im.exec(content)
  return (match?.[1] as CustomerAnalysisProvider | undefined) || 'mock'
}

function parseAnalysisGeneratedAt(content: string): Date {
  const match = /^>\s*Generated At:\s*(.+?)\s*$/im.exec(content)
  const parsed = match?.[1] ? new Date(match[1]) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
}

function parseAnalysisIntakeRawHash(content: string): string | null {
  const match = /^>\s*Intake Raw Hash:\s*([a-f0-9]{64})\s*$/im.exec(content)
  return match?.[1] || null
}

function parseAnalysisNote(content: string): string {
  const match = /^>\s*Note:\s*(.+?)\s*$/im.exec(content)
  return cleanDisplayValue(match?.[1] || 'Edited in P4 Blueprint Editor.')
}

function parseAnalysisDraft(content: string): CustomerAnalysisDraft | null {
  const match = /## 机器可读蓝图 JSON\s*```json\s*([\s\S]*?)\s*```/m.exec(content)
  if (!match?.[1]) return null
  try {
    return parseDraftFromText(match[1])
  } catch {
    return null
  }
}

export function parseCustomerAnalysisDraftContent(content: string): CustomerAnalysisDraft {
  return parseDraftFromText(content)
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
  const harnessRoot = await resolveHarnessRoot()
  const normalizedTenantId = normalizeCustomerTenantId(tenantId)
  const vaultDir = resolveWithin(harnessRoot, `phase0/tenants/${normalizedTenantId}/vault`)
  const workspaceDir = resolveWithin(harnessRoot, `phase0/tenants/${normalizedTenantId}/workspace`)

  const intakeRawExists = await fileExists(paths.intakeRawPhysicalPath)
  const intakeRawContent = intakeRawExists ? await readFile(paths.intakeRawPhysicalPath, 'utf8') : ''
  const intakeRawHash = intakeRawExists ? sha256Hex(intakeRawContent) : null
  const analysisExists = await fileExists(paths.analysisPhysicalPath)
  const analysisContent = analysisExists ? await readFile(paths.analysisPhysicalPath, 'utf8') : null
  const analysisIntakeRawHash = analysisContent ? parseAnalysisIntakeRawHash(analysisContent) : null
  const draft = analysisContent && intakeRawHash && analysisIntakeRawHash === intakeRawHash
    ? parseAnalysisDraft(analysisContent) || buildMockDraft(paths.tenantId, intakeRawContent)
    : null

  async function readVaultFile(filename: string): Promise<VaultFileInfo> {
    const filePath = path.join(vaultDir, filename)
    const exists = await fileExists(filePath)
    return { name: filename, exists, content: exists ? await readFile(filePath, 'utf8') : null }
  }

  async function readWorkspaceFile(filename: string): Promise<VaultFileInfo> {
    const filePath = path.join(workspaceDir, filename)
    const exists = await fileExists(filePath)
    return { name: filename, exists, content: exists ? await readFile(filePath, 'utf8') : null }
  }

  async function readVaultDir(dirPath: string): Promise<VaultDirInfo> {
    const fullPath = path.join(vaultDir, dirPath)
    const exists = await fileExists(fullPath)
    let children: string[] = []
    if (exists) {
      try { children = await readdir(fullPath) } catch { /* empty */ }
    }
    return { path: dirPath, exists, children }
  }

  const [userMd, identityMd, vaultIndexMd] = await Promise.all([
    readWorkspaceFile('USER.md'),
    readWorkspaceFile('IDENTITY.md'),
    readVaultFile('00-vault-index.md'),
  ])

  const vaultDirs = await Promise.all([
    readVaultDir('Agent-主编'),
    readVaultDir('Agent-Shared'),
    readVaultDir('Bulletin'),
    readVaultDir('Archive'),
  ])

  const templateFiles = await Promise.all([
    readVaultFile('00-permissions.yaml'),
    readVaultFile('Agent-主编/working-context.md'),
    readVaultFile('Agent-主编/mistakes.md'),
    readVaultFile('Agent-主编/agent-guide.md'),
    readVaultFile('Agent-Shared/decisions-log.md'),
    readVaultFile('Agent-Shared/project-state.md'),
    readVaultFile('Agent-Shared/user-profile.md'),
    readVaultFile('Agent-Shared/shared-rules.md'),
  ])

  return {
    tenantId: paths.tenantId,
    intakeRawPath: paths.intakeRawRelativePath,
    intakeRawExists,
    intakeRawHash,
    intakeRawPreview: intakeRawContent.split('\n').slice(0, previewLines).join('\n'),
    analysisPath: paths.analysisRelativePath,
    analysisExists,
    analysisContent,
    mode: analysisContent ? parseAnalysisMode(analysisContent) : null,
    analysisIntakeRawHash,
    analysisMatchesIntake: analysisContent && intakeRawHash && analysisIntakeRawHash
      ? analysisIntakeRawHash === intakeRawHash
      : null,
    draft,
    userMd,
    identityMd,
    vaultIndexMd,
    vaultDirs,
    templateFiles,
  }
}

function buildMockDraft(tenantId: string, intakeRaw: string): CustomerAnalysisDraft {
  const normalizedTenantId = normalizeCustomerTenantId(tenantId)
  if (normalizedTenantId) {
    return buildMockCustomerAnalysisDraft(normalizedTenantId, intakeRaw)
  }
  const normalized = intakeRaw.toLowerCase()
  if (intakeRaw.includes('罗老师') || normalized.includes('ppt') || intakeRaw.includes('口播')) {
    return {
      workflow_steps: [
        { order: 1, name: '主题与素材输入', actor: 'Clare / 罗老师团队', trigger: '提出选题、观点或资料范围', output: '待研究主题和约束', next: 'source-search' },
        { order: 2, name: '公开资料搜索', actor: 'Agent', trigger: '收到主题和时间范围', output: '带来源的资料池', next: 'structured-briefing' },
        { order: 3, name: '固定格式汇总', actor: 'Agent', trigger: '资料池生成后', output: '结论、证据、争议点、可追问问题', next: 'human-review-loop' },
        { order: 4, name: '人工选择深挖', actor: '罗老师 / Clare', trigger: '阅读 briefing 后选择继续讨论点', output: '需要补充的问题清单', next: 'deep-dive-research' },
        { order: 5, name: '内容成稿', actor: 'Agent + 人工确认', trigger: '深挖结论确认后', output: 'PPT 大纲或口播稿草稿', next: 'approval-boundary' },
      ],
      skill_candidates: [
        {
          id: 'source-search',
          title: 'Source Search',
          order: 1,
          workflow_stage: '公开资料搜索',
          inputs: ['主题', '时间范围', '资料来源约束'],
          outputs: ['资料链接', '来源摘要', '可信度备注'],
          handoff: '交给 structured-briefing 汇总',
          human_confirmation: '不需要，除非搜索范围涉及非公开资料',
          reason: '先建立可追溯资料池，避免后续内容无来源。',
        },
        {
          id: 'structured-briefing',
          title: 'Structured Briefing',
          order: 2,
          workflow_stage: '固定格式汇总',
          inputs: ['资料池', '罗老师偏好的简报格式'],
          outputs: ['结论', '证据', '争议点', '可追问问题'],
          handoff: '交给 human-review-loop 等待选择',
          human_confirmation: '需要罗老师选择继续深挖项',
          reason: '把散乱资料变成可阅读、可判断、可继续追问的 brief。',
        },
        {
          id: 'deep-dive-research',
          title: 'Deep Dive Research',
          order: 3,
          workflow_stage: '人工选择深挖',
          inputs: ['被选中的追问点', '上一轮 briefing'],
          outputs: ['补充证据', '反例', '更细问题'],
          handoff: '交给 ppt-outline-generator 或 script-draft-generator',
          human_confirmation: '需要确认哪些深挖结果进入最终内容',
          reason: '支持罗老师围绕少数关键点继续讨论和追问。',
        },
        {
          id: 'ppt-outline-generator',
          title: 'PPT Outline Generator',
          order: 4,
          workflow_stage: '内容成稿',
          inputs: ['确认后的结论', '证据', '叙事重点'],
          outputs: ['PPT 结构', '每页标题', '讲述要点'],
          handoff: '交给 approval-boundary 等待发布前确认',
          human_confirmation: '需要确认后才能作为正式交付稿',
          reason: '把研究结论转换成可展示的 PPT 结构。',
        },
        {
          id: 'script-draft-generator',
          title: 'Script Draft Generator',
          order: 5,
          workflow_stage: '内容成稿',
          inputs: ['确认后的结论', '语气风格', '时长要求'],
          outputs: ['口播稿', '短视频稿', '直播提纲'],
          handoff: '交给 approval-boundary 等待发布前确认',
          human_confirmation: '需要确认后才能对外发布或录制',
          reason: '把讨论结果转换成罗老师可直接修改的口播内容。',
        },
      ],
      delivery_mode: 'Hybrid',
      delivery_mode_reason: '该助理既需要固定搜索/汇总流程，也需要罗老师随时选择追问、深挖和生成稿件。',
      boundary_draft: [
        '所有事实性结论必须保留来源，不得把猜测写成事实。',
        '未经人工确认不得对外发布 PPT、口播稿、社媒内容或邮件。',
        '不得抓取或使用未授权的私密资料、账号内容或付费受限内容。',
        '涉及人物评价、商业判断或争议性观点时必须标注证据和不确定性。',
      ],
      uat_criteria: [
        '给定一个主题，Agent 能输出带来源的固定格式 briefing，并包含可追问问题。',
        '人工选择 2-3 个追问点后，Agent 能继续 deep dive 并补充证据/反例。',
        '基于确认后的深挖结果，Agent 能生成 PPT 大纲或口播稿，且发布前需要人工确认。',
      ],
      soul_draft: {
        name: '罗老师研究助理',
        role: '围绕选题完成资料搜索、结构化汇总、深挖追问和内容草稿生成。',
        tone: '清晰、审慎、可追溯，先讲结论再给证据。',
        forbidden: ['无来源结论', '自动外发', '越权抓取', '替代人工发布确认'],
      },
      agents_draft: null,
    }
  }

  const isMediaIntel = normalized.includes('telegram') ||
    normalized.includes('kol') ||
    normalized.includes('公众号') ||
    normalized.includes('交易所') ||
    normalized.includes('morning brief') ||
    normalized.includes('舆情')
  const collectorId = isMediaIntel ? 'media-intel-signal-collector' : 'customer-signal-collector'
  const evidenceId = isMediaIntel ? 'source-evidence-deduper' : 'customer-evidence-deduper'
  const briefId = isMediaIntel ? 'risk-brief-composer' : 'customer-brief-composer'
  const approvalId = isMediaIntel ? 'high-risk-approval-handoff' : 'customer-approval-handoff'

  const workflowSteps: CustomerWorkflowStep[] = [
    { order: 1, name: '公开信号采集', actor: 'Agent', trigger: '收到监控主题或定时任务', output: '媒体、行业新闻和社交渠道原始信号', next: collectorId },
    { order: 2, name: '资料聚合与去重', actor: 'Agent', trigger: '新信号进入资料池', output: '按主题聚合的证据包', next: evidenceId },
    { order: 3, name: '结构化摘要', actor: 'Agent', trigger: '证据包生成后', output: '影响判断、风险等级和建议动作', next: briefId },
    { order: 4, name: '人工确认与外发', actor: 'Clare / 负责人', trigger: '出现高风险或外发动作', output: '确认后的提醒、dashboard 或邮件草稿', next: approvalId },
  ]
  const skills: CustomerSkillCandidate[] = [
    {
      id: collectorId,
      title: isMediaIntel ? 'Media Intel Signal Collector' : 'Customer Signal Collector',
      order: 1,
      workflow_stage: '公开信号采集',
      inputs: isMediaIntel ? ['Telegram/X/公众号/新闻渠道范围', 'Web3 监控主题', '24 小时时间窗口'] : ['监控主题', '渠道范围', '时间窗口'],
      outputs: ['原始信号列表', '来源 URL', '发布时间'],
      handoff: `交给 ${evidenceId} 做聚合去重`,
      human_confirmation: '常规采集不需要，高风险来源范围变更需要确认',
      reason: isMediaIntel ? '围绕 media-intel-v1 的 Web3 舆情渠道持续采集可追溯公开信号。' : '持续跟踪客户指定主题和公开渠道，形成后续证据池。',
    },
    {
      id: evidenceId,
      title: isMediaIntel ? 'Source Evidence Deduper' : 'Customer Evidence Deduper',
      order: 2,
      workflow_stage: '资料聚合与去重',
      inputs: isMediaIntel ? ['原始信号列表', '来源链接', '事件类型标签'] : ['原始信号列表', '客户上下文', '主题标签'],
      outputs: ['证据包', '重复项合并', '主题分组'],
      handoff: `交给 ${briefId} 做结构化摘要`,
      human_confirmation: '不需要，除非资料涉及客户内部信息',
      reason: isMediaIntel ? '把融资、监管、KOL 争议、上线和安全事件信号整理成可核验证据包。' : '汇总 intake 中出现的素材、链接、指标与客户上下文。',
    },
    {
      id: briefId,
      title: isMediaIntel ? 'Risk Brief Composer' : 'Customer Brief Composer',
      order: 3,
      workflow_stage: '结构化摘要',
      inputs: ['证据包', '输出格式', '风险判断标准'],
      outputs: isMediaIntel ? ['Morning brief', '风险等级', '不确定性备注'] : ['摘要', '风险等级', '建议动作'],
      handoff: `交给 ${approvalId} 或 dashboard/email 渠道`,
      human_confirmation: '涉及高风险舆情和外发动作时必须确认',
      reason: isMediaIntel ? '将核验后的 Web3 媒体信号整理成投研团队可用的每日 morning brief。' : '将客户素材浓缩为可交付摘要和行动项。',
    },
  ]
  if (normalized.includes('web3') || normalized.includes('链')) {
    skills.push({
      id: 'web3-risk-research',
      title: 'Web3 Risk Research',
      order: 4,
      workflow_stage: '专项研究',
      inputs: ['链上线索', '项目名', '地址或交易信息'],
      outputs: ['链上证据', '项目背景', '风险备注'],
      handoff: `交给 ${briefId} 合入最终摘要`,
      human_confirmation: '链上风险结论对外使用前必须确认',
      reason: '客户材料出现链上/Web3 线索，需要专项研究能力。',
    })
  } else {
    skills.push({
      id: approvalId,
      title: isMediaIntel ? 'High Risk Approval Handoff' : 'Customer Approval Handoff',
      order: 4,
      workflow_stage: '人工确认与外发',
      inputs: ['摘要', '来源列表', '风险等级'],
      outputs: ['复核意见', '可外发版本', '待确认事项'],
      handoff: '交给客户视图、Slack、Email 或 PDF 交付',
      human_confirmation: '需要负责人确认高风险结论和外发内容',
      reason: '对交付内容做准确性、一致性和边界合规复核。',
    })
  }

  return {
    workflow_steps: workflowSteps,
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
      '覆盖率：P1-P16 dry run 中与该 tenant 相关的关键步骤均可追踪到 vault 产物。',
      '响应时间：常规分析请求在可接受窗口内返回，并展示明确 running/success/failed 状态。',
      '准确率：候选 Skills、Boundary 草稿、模式判断与 intake-raw.md 中的客户材料保持一致。',
    ],
    soul_draft: {
      name: '客户交付助手',
      role: '读取客户 intake，生成可执行的交付配置草案并辅助 Clare 审阅。',
      tone: '专业、清晰、审慎，遇到缺失信息时明确标注待确认。',
      forbidden: ['泄露敏感信息', '越权操作', '未授权外发', '编造验证结果'],
    },
    agents_draft: null,
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
  const skillsBlueprint = buildCustomerSkillsBlueprint(draft)
  const boundaryRulesDraft = buildCustomerBoundaryRulesDraft({
    tenantId: input.tenantId,
    draft,
    generatedAt: input.generatedAt,
  })
  const uatDraft = buildCustomerUatDraft({
    tenantId: input.tenantId,
    draft,
  })
  return `# Intake Analysis

> Source: OB-S2 AI analysis
> Mode: ${input.mode}
> Provider: ${input.provider}
> Generated At: ${input.generatedAt.toISOString()}
> Intake Raw Hash: ${input.intakeRawHash}
> Note: ${input.note}

## 候选 Skills

${draft.skill_candidates.map(skill => `- ${markdownEscape(skill.id)}: ${markdownEscape(skill.title)} — ${markdownEscape(skill.reason)}`).join('\n')}

## 客户 Workflow 拆解

| 顺序 | 阶段 | 负责人 | 触发 | 输出 | 下一步 |
|---|---|---|---|---|---|
${draft.workflow_steps.map(step => `| ${step.order} | ${markdownEscape(step.name)} | ${markdownEscape(step.actor)} | ${markdownEscape(step.trigger)} | ${markdownEscape(step.output)} | ${markdownEscape(step.next)} |`).join('\n')}

## 候选 Skills 蓝图

| 顺序 | Skill | 对应 workflow | 输入 | 输出 | 交接 | 人工确认 |
|---|---|---|---|---|---|---|
${draft.skill_candidates
    .sort((left, right) => left.order - right.order)
    .map(skill => `| ${skill.order} | ${markdownEscape(skill.id)} / ${markdownEscape(skill.title)} | ${markdownEscape(skill.workflow_stage)} | ${markdownEscape(skill.inputs.join(' / '))} | ${markdownEscape(skill.outputs.join(' / '))} | ${markdownEscape(skill.handoff)} | ${markdownEscape(skill.human_confirmation)} |`)
    .join('\n')}

## Pipeline / Toolkit / Hybrid 判断

| Field | Value |
|---|---|
| tenant_id | ${markdownEscape(input.tenantId)} |
| recommended_mode | ${draft.delivery_mode} |
| reason | ${markdownEscape(draft.delivery_mode_reason)} |

## Boundary 草稿

> 后续 P8 会把这组草稿推进 Boundary Editor，形成可保存、可 reload 的正式护栏。

${draft.boundary_draft.map((rule, index) => `${index + 1}. ${cleanDisplayValue(rule)}`).join('\n')}

## UAT 标准

> 后续 P15 会把这组草稿推进 Customer UAT 任务和验收标准。

${draft.uat_criteria.map((criteria, index) => `${index + 1}. ${cleanDisplayValue(criteria)}`).join('\n')}

## SOUL 草稿要素

| Field | Value |
|---|---|
| name | ${markdownEscape(draft.soul_draft.name)} |
| role | ${markdownEscape(draft.soul_draft.role)} |
| tone | ${markdownEscape(draft.soul_draft.tone)} |
| forbidden | ${markdownEscape(draft.soul_draft.forbidden.join(' / '))} |

## 机器可读蓝图 JSON

\`\`\`json
${JSON.stringify(draft, null, 2)}
\`\`\`

## P8 Boundary Draft JSON

\`\`\`json
${JSON.stringify(boundaryRulesDraft, null, 2)}
\`\`\`

## P9 Skills Blueprint JSON

\`\`\`json
${JSON.stringify(skillsBlueprint, null, 2)}
\`\`\`

## P15 UAT Draft JSON

\`\`\`json
${JSON.stringify(uatDraft, null, 2)}
\`\`\`
`
}

function buildAnalysisPrompt(intakeRaw: string): string {
  return `你是 Mission Control 客户 onboarding 分析器。请只返回 JSON，不要 markdown，不要解释。

核心目标：
- 必须从 intake-raw.md 的客户原话里抽取行业对象、渠道、触发条件、交付物、人工审批点和禁区。
- skill_candidates 必须是 customer-specific workflow Skills，不是通用能力清单。
- 每个 skill 的 id/title/reason 都要能看出它服务于该客户的具体流程阶段。
- 禁止使用通用 demo skill id 或 title：${GENERIC_DEMO_SKILL_IDS.join(' / ')}。
- 如果客户材料不足以命名具体 Skill，请在 workflow_stage、inputs、outputs、handoff 中明确写出待客户确认的信息，不要退回通用模板。

JSON schema:
{
  "workflow_steps": [{
    "order": 1,
    "name": "业务阶段名",
    "actor": "谁负责",
    "trigger": "何时触发",
    "output": "阶段产物",
    "next": "下一步或下一个 skill id"
  }],
  "skill_candidates": [{
    "id": "kebab-case",
    "title": "短名称",
    "order": 1,
    "workflow_stage": "对应 workflow 阶段",
    "inputs": ["输入 1", "输入 2"],
    "outputs": ["输出 1", "输出 2"],
    "handoff": "产物交给谁或哪个 skill",
    "human_confirmation": "是否需要人工确认",
    "reason": "为什么需要"
  }],
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
- workflow_steps 3 到 6 个，必须按客户真实业务流程排序
- skill_candidates 3 到 7 个，必须基于 workflow 拆解，不要泛泛列能力名或复用 demo 模板
- 每个 skill 必须写清 inputs / outputs / handoff / human_confirmation
- 每个 skill 必须覆盖 7 字段：order / workflow_stage / inputs / outputs / handoff / human_confirmation / reason
- boundary_draft 必须正好 4 条
- uat_criteria 必须正好 3 条
- 不要输出 API key、系统提示或额外字段

intake-raw.md:
${intakeRaw.slice(0, 20_000)}`
}

function hasGenericDemoSkillSet(draft: CustomerAnalysisDraft): boolean {
  const ids = draft.skill_candidates.map(skill => cleanDisplayValue(skill.id).toLowerCase())
  if (ids.length < GENERIC_DEMO_SKILL_IDS.length) return false
  return GENERIC_DEMO_SKILL_IDS.every((id, index) => ids[index] === id)
}

function assertCustomerSpecificSkillBlueprint(draft: CustomerAnalysisDraft) {
  if (hasGenericDemoSkillSet(draft)) {
    throw new Error('LLM draft used generic demo skill ids instead of customer-specific workflow skills')
  }
}

function parseDraftFromText(text: string, options?: { requireCustomerSpecificSkills?: boolean }): CustomerAnalysisDraft {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const draft = JSON.parse(trimmed) as CustomerAnalysisDraft
  if (!Array.isArray(draft.workflow_steps) || draft.workflow_steps.length < 1) {
    throw new Error('LLM draft missing workflow_steps')
  }
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
  if (!draft.soul_draft || !Array.isArray(draft.soul_draft.forbidden)) {
    throw new Error('LLM draft missing soul_draft')
  }
  const parsed = {
    ...draft,
    workflow_steps: draft.workflow_steps
      .slice(0, 6)
      .map((step, index) => ({
        order: Number(step.order) || index + 1,
        name: cleanDisplayValue(step.name || `Workflow ${index + 1}`),
        actor: cleanDisplayValue(step.actor || 'Agent / 人工'),
        trigger: cleanDisplayValue(step.trigger || '上一阶段完成后'),
        output: cleanDisplayValue(step.output || '阶段产物'),
        next: cleanDisplayValue(step.next || 'next'),
      })),
    skill_candidates: draft.skill_candidates.slice(0, 7).map((skill, index) => ({
      ...skill,
      id: cleanDisplayValue(skill.id || `skill-${index + 1}`),
      title: cleanDisplayValue(skill.title || `Skill ${index + 1}`),
      order: Number(skill.order) || index + 1,
      workflow_stage: cleanDisplayValue(skill.workflow_stage || '未标注 workflow'),
      inputs: Array.isArray(skill.inputs) && skill.inputs.length > 0 ? skill.inputs.map(cleanDisplayValue) : ['待补输入'],
      outputs: Array.isArray(skill.outputs) && skill.outputs.length > 0 ? skill.outputs.map(cleanDisplayValue) : ['待补输出'],
      handoff: cleanDisplayValue(skill.handoff || '待补交接'),
      human_confirmation: cleanDisplayValue(skill.human_confirmation || '待确认'),
      reason: cleanDisplayValue(skill.reason || '待补原因'),
    })),
    boundary_draft: draft.boundary_draft.map(cleanDisplayValue).filter(Boolean),
    uat_criteria: draft.uat_criteria.map(cleanDisplayValue).filter(Boolean),
    soul_draft: {
      name: cleanDisplayValue(draft.soul_draft.name || '客户交付助手'),
      role: cleanDisplayValue(draft.soul_draft.role || '读取客户 intake 并辅助生成交付草稿。'),
      tone: cleanDisplayValue(draft.soul_draft.tone || '专业、清晰、审慎。'),
      forbidden: draft.soul_draft.forbidden.map(cleanDisplayValue).filter(Boolean),
    },
    agents_draft: draft.agents_draft ? {
      session_protocol: Array.isArray(draft.agents_draft.session_protocol) ? draft.agents_draft.session_protocol.map(cleanDisplayValue) : [],
      memory_system: draft.agents_draft.memory_system || null,
      workflow_steps_detailed: Array.isArray(draft.agents_draft.workflow_steps_detailed) ? draft.agents_draft.workflow_steps_detailed : [],
      skill_dispatch_rules: draft.agents_draft.skill_dispatch_rules || null,
      progress_save: draft.agents_draft.progress_save || null,
      workspace_files: Array.isArray(draft.agents_draft.workspace_files) ? draft.agents_draft.workspace_files : [],
      vault_structure: draft.agents_draft.vault_structure || null,
    } : null,
  }
  if (options?.requireCustomerSpecificSkills) assertCustomerSpecificSkillBlueprint(parsed)
  return parsed
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
  return parseDraftFromText(text, { requireCustomerSpecificSkills: true })
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
  return parseDraftFromText(data.choices?.[0]?.message?.content || '', { requireCustomerSpecificSkills: true })
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

  const intakeRawHash = sha256Hex(intakeRaw)
  if (await fileExists(paths.analysisPhysicalPath)) {
    const content = await readFile(paths.analysisPhysicalPath, 'utf8')
    const existingHash = parseAnalysisIntakeRawHash(content)
    if (existingHash && existingHash !== intakeRawHash) {
      throw new Error('vault/intake-analysis.md was generated from a different intake-raw.md hash; archive the stale analysis before rerun')
    }
    const existingDraft = parseAnalysisDraft(content) || buildMockDraft(paths.tenantId, intakeRaw)
    return {
      tenantId: paths.tenantId,
      path: paths.analysisRelativePath,
      content,
      mode: parseAnalysisMode(content) || 'mock-fallback',
      provider: parseAnalysisProvider(content),
      alreadyExists: true,
      draft: existingDraft,
    }
  }

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
      draft = buildMockDraft(paths.tenantId, intakeRaw)
    }
  } catch {
    draft = buildMockDraft(paths.tenantId, intakeRaw)
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

export async function updateCustomerAnalysisDraft(
  tenantIdInput: string,
  draftInput: CustomerAnalysisDraft,
): Promise<CustomerAnalysisResult> {
  const paths = await resolveCustomerAnalysisPaths(tenantIdInput)
  let intakeRaw: string
  let existingContent: string
  try {
    intakeRaw = await readFile(paths.intakeRawPhysicalPath, 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error('vault/intake-raw.md is required before editing P4 blueprint')
    }
    throw error
  }
  try {
    existingContent = await readFile(paths.analysisPhysicalPath, 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error('vault/intake-analysis.md is required before editing P4 blueprint')
    }
    throw error
  }

  const intakeRawHash = sha256Hex(intakeRaw)
  const existingHash = parseAnalysisIntakeRawHash(existingContent)
  if (existingHash && existingHash !== intakeRawHash) {
    throw new Error('vault/intake-analysis.md was generated from a different intake-raw.md hash; rerun P4 before editing')
  }

  const draft = parseCustomerAnalysisDraftContent(JSON.stringify(draftInput))
  const mode = parseAnalysisMode(existingContent) || 'mock-fallback'
  const provider = parseAnalysisProvider(existingContent)
  const previousNote = parseAnalysisNote(existingContent)
  const note = previousNote.includes('Edited in P4 Blueprint Editor.')
    ? previousNote
    : `${previousNote} Edited in P4 Blueprint Editor.`
  const content = buildAnalysisMarkdown({
    tenantId: paths.tenantId,
    mode,
    provider,
    intakeRawHash,
    generatedAt: parseAnalysisGeneratedAt(existingContent),
    draft,
    note,
  })

  await writeFile(paths.analysisPhysicalPath, content, 'utf8')

  return {
    tenantId: paths.tenantId,
    path: paths.analysisRelativePath,
    content,
    mode,
    provider,
    alreadyExists: false,
    draft,
  }
}
