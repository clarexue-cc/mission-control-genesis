import type { CustomerAnalysisDraft } from '@/lib/customer-analysis'

export type MockFallbackMode = 'llm-anthropic' | 'llm-openai' | 'mock-fallback'
export type MockFallbackProvider = 'anthropic' | 'openai' | 'mock'

export interface MockCustomerSoulDraft {
  soul_md: string
  agents_md: string
}

export const CUSTOMER_MOCK_FALLBACK_TEMPLATE_ROOT = 'phase0/templates/mock-fallback-by-tenant'

const MOCK_FALLBACK_NOTE = '未配置 ANTHROPIC_API_KEY / OPENAI_API_KEY，或 LLM 调用失败；本文件使用 mock fallback 生成，供 dry run 流程继续验证。真客户上线前需配置 LLM env。'

function cleanDisplayValue(value: string): string {
  return value.replace(/[\0\r]/g, '').trim()
}

function markdownEscape(value: string): string {
  return cleanDisplayValue(value).replace(/\|/g, '\\|')
}

function normalizeTenantKey(tenantId: string): 'wechat-mp-agent' | 'media-intel-v1' | 'web3-research-v1' | 'default' {
  if (tenantId === 'wechat-mp-agent') return 'wechat-mp-agent'
  if (tenantId === 'media-intel-v1') return 'media-intel-v1'
  if (tenantId === 'web3-research-v1') return 'web3-research-v1'
  return 'default'
}

function ceoAnalysisDraft(): CustomerAnalysisDraft {
  return {
    workflow_steps: [
      { order: 1, name: 'CEO 信息雷达配置', actor: 'CEO / Clare', trigger: '设定关注主题、人物和公司', output: '资讯源、人物列表和优先级', next: 'ceo-news-aggregator' },
      { order: 2, name: '每日资讯聚合', actor: 'Agent', trigger: '工作日固定时间或临时查询', output: '按主题归档的 CEO 简报素材', next: 'socratic-discussion-partner' },
      { order: 3, name: '苏格拉底讨论', actor: 'CEO + Agent', trigger: 'CEO 选择一个判断点继续追问', output: '问题链、反例和待确认假设', next: 'course-ppt-generator' },
      { order: 4, name: '课程 PPT 生成', actor: 'Agent + 人工确认', trigger: '讨论结论确认后', output: '课程 PPT 大纲、页标题和讲述要点', next: 'notable-person-tracker' },
      { order: 5, name: '名人动态追踪', actor: 'Agent', trigger: '关注人物出现新公开动态', output: '人物动态卡片和影响判断', next: 'approval-handoff' },
    ],
    skill_candidates: [
      {
        id: 'ceo-news-aggregator',
        title: 'CEO 资讯聚合',
        order: 1,
        workflow_stage: '每日资讯聚合',
        inputs: ['关注主题', '公开资讯源', '时间窗口'],
        outputs: ['CEO 简报素材', '来源链接', '重要性排序'],
        handoff: '交给 socratic-discussion-partner 做追问讨论',
        human_confirmation: '新增资讯源或高风险结论需要 CEO / Clare 确认',
        reason: 'CEO 助理需要先把散落公开信息聚合成可追溯的判断材料。',
      },
      {
        id: 'socratic-discussion-partner',
        title: '苏格拉底讨论',
        order: 2,
        workflow_stage: '苏格拉底讨论',
        inputs: ['CEO 选择的问题', '资讯聚合结果', '业务假设'],
        outputs: ['问题链', '反例', '待确认假设'],
        handoff: '交给 course-ppt-generator 或继续人工讨论',
        human_confirmation: '需要 CEO 选择保留哪些判断进入输出',
        reason: '用追问把资讯变成 CEO 可决策的观点，而不是简单摘要。',
      },
      {
        id: 'course-ppt-generator',
        title: '课程 PPT 生成',
        order: 3,
        workflow_stage: '课程 PPT 生成',
        inputs: ['确认后的观点', '课程主题', '受众画像'],
        outputs: ['PPT 大纲', '每页标题', '讲述要点'],
        handoff: '交给 approval-handoff 等待发布前确认',
        human_confirmation: '正式交付前必须人工确认',
        reason: 'CEO 助理场景需要把讨论沉淀为课程级结构化内容。',
      },
      {
        id: 'notable-person-tracker',
        title: '名人动态追踪',
        order: 4,
        workflow_stage: '名人动态追踪',
        inputs: ['人物列表', '公开动态源', '关注关键词'],
        outputs: ['人物动态卡片', '影响判断', '后续追问建议'],
        handoff: '交给 ceo-news-aggregator 合入下一轮简报',
        human_confirmation: '人物评价和对外引用前需要确认',
        reason: 'CEO 助理需要持续追踪关键人物，辅助议题选择和观点更新。',
      },
    ],
    delivery_mode: 'Hybrid',
    delivery_mode_reason: 'CEO 助理需要固定 7 步 pipeline 托底，也需要 CEO 随时追问和生成课程 PPT 的工具化能力。',
    boundary_draft: [
      '所有事实、人物动态和商业判断必须保留公开来源，不得把推测写成事实。',
      '未经 CEO / Clare 确认不得对外发布 PPT、课程稿、邮件或社媒内容。',
      '不得抓取未授权的私密资料、账号内容、付费受限内容或内部文件。',
      '涉及人物评价、商业建议或争议议题时必须标注证据、不确定性和待确认点。',
    ],
    uat_criteria: [
      '给定一个 CEO 关注主题，Agent 能输出含来源的资讯聚合 brief，并给出可追问问题。',
      'CEO 选择问题后，Agent 能进行苏格拉底式追问，输出反例、假设和下一步材料需求。',
      '基于确认后的观点，Agent 能生成课程 PPT 大纲，并在发布前停在人工确认。',
    ],
    soul_draft: {
      name: 'CEO 助理人格',
      role: '围绕 CEO 的资讯聚合、苏格拉底讨论、课程 PPT 生成和名人动态追踪提供可追溯支持。',
      tone: '冷静、直接、追问式，先给判断再给证据和待确认项。',
      forbidden: ['无来源结论', '自动外发', '越权抓取', '替代 CEO 做最终判断'],
    },
    agents_draft: null,
  }
}

function mediaIntelAnalysisDraft(): CustomerAnalysisDraft {
  return {
    workflow_steps: [
      { order: 1, name: '公开信号采集', actor: 'Agent', trigger: '收到监控主题或定时任务', output: '媒体、行业新闻和社交渠道原始信号', next: 'media-intel-signal-collector' },
      { order: 2, name: '资料聚合与去重', actor: 'Agent', trigger: '新信号进入资料池', output: '按主题聚合的证据包', next: 'source-evidence-deduper' },
      { order: 3, name: '结构化摘要', actor: 'Agent', trigger: '证据包生成后', output: '影响判断、风险等级和建议动作', next: 'risk-brief-composer' },
      { order: 4, name: '人工确认与外发', actor: 'Clare / 负责人', trigger: '出现高风险或外发动作', output: '确认后的提醒、dashboard 或邮件草稿', next: 'high-risk-approval-handoff' },
    ],
    skill_candidates: [
      {
        id: 'media-intel-signal-collector',
        title: 'Media Intel Signal Collector',
        order: 1,
        workflow_stage: '公开信号采集',
        inputs: ['Telegram/X/公众号/新闻渠道范围', 'Web3 监控主题', '24 小时时间窗口'],
        outputs: ['原始信号列表', '来源 URL', '发布时间'],
        handoff: '交给 source-evidence-deduper 做聚合去重',
        human_confirmation: '常规采集不需要，高风险来源范围变更需要确认',
        reason: '围绕 media-intel-v1 的 Web3 舆情渠道持续采集可追溯公开信号。',
      },
      {
        id: 'source-evidence-deduper',
        title: 'Source Evidence Deduper',
        order: 2,
        workflow_stage: '资料聚合与去重',
        inputs: ['原始信号列表', '来源链接', '事件类型标签'],
        outputs: ['证据包', '重复项合并', '主题分组'],
        handoff: '交给 risk-brief-composer 做结构化摘要',
        human_confirmation: '不需要，除非资料涉及客户内部信息',
        reason: '把融资、监管、KOL 争议、上线和安全事件信号整理成可核验证据包。',
      },
      {
        id: 'risk-brief-composer',
        title: 'Risk Brief Composer',
        order: 3,
        workflow_stage: '结构化摘要',
        inputs: ['证据包', '输出格式', '风险判断标准'],
        outputs: ['Morning brief', '风险等级', '不确定性备注'],
        handoff: '交给 high-risk-approval-handoff 或 dashboard/email 渠道',
        human_confirmation: '涉及高风险舆情和外发动作时必须确认',
        reason: '将核验后的 Web3 媒体信号整理成投研团队可用的每日 morning brief。',
      },
      {
        id: 'high-risk-approval-handoff',
        title: 'High Risk Approval Handoff',
        order: 4,
        workflow_stage: '人工确认与外发',
        inputs: ['摘要', '来源列表', '风险等级'],
        outputs: ['复核意见', '可外发版本', '待确认事项'],
        handoff: '交给客户视图、Slack、Email 或 PDF 交付',
        human_confirmation: '需要负责人确认高风险结论和外发内容',
        reason: '对交付内容做准确性、一致性和边界合规复核。',
      },
    ],
    delivery_mode: 'Hybrid',
    delivery_mode_reason: '媒体情报工作需要定时采集、证据聚合、Morning brief 和高风险人工确认共同运行。',
    boundary_draft: [
      '禁止泄露客户访谈、账号、密钥、合同、内部资料等敏感信息。',
      '禁止越权访问未授权系统、租户、文件路径或第三方平台。',
      '禁止未经确认对外发送邮件、消息、交易、发布内容或修改生产数据。',
      '禁止生成或声称已验证不存在来源的假数据、假截图、假客户结论。',
    ],
    uat_criteria: [
      '给定一组公开渠道，Agent 能生成包含来源链接、发布时间和主题分组的信号列表。',
      '给定证据包，Agent 能输出 Morning brief、风险等级和不确定性备注。',
      '高风险舆情、外发动作和客户邮件必须停在人工确认节点。',
    ],
    soul_draft: {
      name: '媒体情报人格',
      role: '围绕公开媒体和社交渠道采集、核验、去重并生成 Morning brief。',
      tone: '审慎、证据优先、风险敏感。',
      forbidden: ['无来源舆情结论', '跨 tenant 读取', '自动外发', '编造风险等级'],
    },
    agents_draft: null,
  }
}

function web3AnalysisDraft(): CustomerAnalysisDraft {
  return {
    workflow_steps: [
      { order: 1, name: '项目线索归档', actor: '投研负责人 / Agent', trigger: '收到项目名、地址或研究问题', output: '项目研究卡片和待查清单', next: 'web3-six-step-evaluator' },
      { order: 2, name: '六步法判断', actor: 'Agent', trigger: '研究卡片生成后', output: '六步法评分、关键假设和反例', next: 'onchain-data-reader' },
      { order: 3, name: '链上数据核验', actor: 'Agent', trigger: '需要验证交易、地址或 TVL 指标', output: '链上证据、数据来源和异常备注', next: 'team-due-diligence' },
      { order: 4, name: '团队尽调', actor: 'Agent + 人工确认', trigger: '项目进入候选池', output: '团队背景、历史项目和利益冲突提示', next: 'compliance-risk-review' },
      { order: 5, name: '合规审查', actor: 'Clare / 合规负责人', trigger: '准备形成投资或对外结论', output: '合规风险清单和可发布版本', next: 'research-approval-handoff' },
    ],
    skill_candidates: [
      {
        id: 'web3-six-step-evaluator',
        title: 'Web3 六步法判断',
        order: 1,
        workflow_stage: '六步法判断',
        inputs: ['项目名', '研究问题', '公开资料'],
        outputs: ['六步法评分', '关键假设', '反例清单'],
        handoff: '交给 onchain-data-reader 做数据验证',
        human_confirmation: '评分进入正式投研结论前需要确认',
        reason: 'Web3 投研需要稳定的六步法判断框架，避免仅凭热度下结论。',
      },
      {
        id: 'onchain-data-reader',
        title: '链上数据核验',
        order: 2,
        workflow_stage: '链上数据核验',
        inputs: ['合约地址', '钱包地址', '链上指标'],
        outputs: ['链上数据', '异常交易备注', '来源链接'],
        handoff: '交给 team-due-diligence 合并项目风险',
        human_confirmation: '链上异常判断对外使用前需要确认',
        reason: '投研结论必须能追溯到公开链上数据，而不是只看二手摘要。',
      },
      {
        id: 'team-due-diligence',
        title: '团队尽调',
        order: 3,
        workflow_stage: '团队尽调',
        inputs: ['团队成员', '历史项目', '融资信息'],
        outputs: ['团队背景', '履历核验', '利益冲突提示'],
        handoff: '交给 compliance-risk-review 进入合规审查',
        human_confirmation: '团队风险评级需要人工确认',
        reason: '团队可信度是 Web3 项目判断的核心变量之一。',
      },
      {
        id: 'compliance-risk-review',
        title: '合规审查',
        order: 4,
        workflow_stage: '合规审查',
        inputs: ['项目研究结论', '地区限制', '代币/证券风险线索'],
        outputs: ['合规风险清单', '禁止外发项', '可发布版本建议'],
        handoff: '交给 research-approval-handoff 等待最终确认',
        human_confirmation: '必须人工确认后才能用于外发或投资建议',
        reason: 'Web3 投研涉及监管、代币和跨境风险，必须显式合规审查。',
      },
    ],
    delivery_mode: 'Hybrid',
    delivery_mode_reason: 'Web3 投研既需要六步法 pipeline，也需要链上查询、团队尽调和合规审查等工具。',
    boundary_draft: [
      '不得把未核验链上数据、二手传闻或社媒观点写成确定性事实。',
      '不得输出未经合规确认的投资建议、代币买卖建议或收益承诺。',
      '不得访问未授权钱包、私钥、交易账户、付费数据库或客户内部资料。',
      '团队尽调和合规判断必须标注来源、不确定性和人工确认状态。',
    ],
    uat_criteria: [
      '给定项目名和地址，Agent 能输出六步法判断、链上数据和来源链接。',
      '给定团队成员信息，Agent 能形成团队尽调摘要并标注待确认风险。',
      '任何投资建议、对外报告或合规敏感结论都必须停在人工确认。',
    ],
    soul_draft: {
      name: '投研专家人格',
      role: '使用六步法判断、链上数据、团队尽调和合规审查支持 Web3 投研。',
      tone: '证据优先、怀疑式、合规敏感。',
      forbidden: ['未经核验下结论', '收益承诺', '越权链上操作', '绕过合规审查'],
    },
    agents_draft: null,
  }
}

function defaultAnalysisDraft(): CustomerAnalysisDraft {
  return {
    workflow_steps: [
      { order: 1, name: '客户材料整理', actor: 'Agent', trigger: '收到 intake-raw.md', output: '通用占位客户上下文', next: 'generic-context-organizer' },
      { order: 2, name: '待确认流程拆解', actor: 'Agent + Clare', trigger: '客户材料不足时', output: '待确认 workflow 草案', next: 'generic-blueprint-drafter' },
      { order: 3, name: '人工补全确认', actor: 'Clare', trigger: '进入正式部署前', output: '可替换为客户专属模板的确认项', next: 'generic-approval-handoff' },
    ],
    skill_candidates: [
      {
        id: 'generic-context-organizer',
        title: '通用占位上下文整理',
        order: 1,
        workflow_stage: '客户材料整理',
        inputs: ['intake-raw.md', '客户名称', '待确认问题'],
        outputs: ['通用占位上下文', '缺口清单'],
        handoff: '交给 generic-blueprint-drafter',
        human_confirmation: '需要 Clare 补充客户专属流程',
        reason: '未知 tenant 只能生成通用占位，避免串入其他客户模板。',
      },
      {
        id: 'generic-blueprint-drafter',
        title: '通用占位蓝图草案',
        order: 2,
        workflow_stage: '待确认流程拆解',
        inputs: ['通用占位上下文', '缺口清单'],
        outputs: ['待确认 workflow', '待确认 Skills'],
        handoff: '交给 generic-approval-handoff',
        human_confirmation: '需要 Clare 确认后才能进入正式客户模板',
        reason: '保持 dry run 可继续，同时明确这不是客户专属结论。',
      },
      {
        id: 'generic-approval-handoff',
        title: '通用占位人工确认',
        order: 3,
        workflow_stage: '人工补全确认',
        inputs: ['待确认 workflow', '待确认 Skills', '边界草案'],
        outputs: ['确认清单', '下一步客户专属模板任务'],
        handoff: '交给 P5/P6 前人工判断',
        human_confirmation: '必须确认',
        reason: '未知 tenant 不应自动复用任何既有客户模板。',
      },
    ],
    delivery_mode: 'Hybrid',
    delivery_mode_reason: '通用占位 fallback 只用于 dry run 连通性验证，正式上线前需要替换为客户专属流程。',
    boundary_draft: [
      '禁止把通用占位内容当作客户正式结论。',
      '禁止串用其他 tenant 的 Skills、SOUL、AGENTS 或业务语料。',
      '禁止未经 Clare 确认进入对外交付、生产部署或客户可见页面。',
      '缺失信息必须标注待确认，不得自动补写为事实。',
    ],
    uat_criteria: [
      '未知 tenant 输出必须明确包含通用占位提示。',
      '未知 tenant 不得包含 CEO、media-intel 或 Web3 专属 Skill ID。',
      '进入正式客户上线前必须完成专属模板补全和人工确认。',
    ],
    soul_draft: {
      name: '通用占位客户交付助手',
      role: '在客户专属模板缺失时维持 dry run 连通，并标注待确认缺口。',
      tone: '清晰、保守、显式标注占位。',
      forbidden: ['串用客户数据', '把占位当事实', '自动外发', '跳过确认'],
    },
    agents_draft: null,
  }
}

export function buildMockCustomerAnalysisDraft(tenantId: string, _intakeRaw: string): CustomerAnalysisDraft {
  switch (normalizeTenantKey(tenantId)) {
    case 'wechat-mp-agent':
      return ceoAnalysisDraft()
    case 'media-intel-v1':
      return mediaIntelAnalysisDraft()
    case 'web3-research-v1':
      return web3AnalysisDraft()
    default:
      return defaultAnalysisDraft()
  }
}

function buildSoulMarkdown(input: {
  tenantId: string
  mode: MockFallbackMode
  provider: MockFallbackProvider
  persona: string
  role: string
  tone: string
  operatingMode: string
  principles: string[]
  forbidden: string[]
  uat: string[]
}): string {
  return `# SOUL

> Source: OB-S5 customer onboarding
> Mode: ${input.mode}
> Provider: ${input.provider}
> Tenant: ${markdownEscape(input.tenantId)}
> Note: ${MOCK_FALLBACK_NOTE}

## 角色定义

- 名称：${markdownEscape(input.persona)}
- 核心职责：${markdownEscape(input.role)}
- 语气风格：${markdownEscape(input.tone)}
- operating_mode: ${markdownEscape(input.operatingMode)}

## 工作原则

${input.principles.map((rule, index) => `${index + 1}. ${cleanDisplayValue(rule)}`).join('\n')}

## 禁止行为

${input.forbidden.map((rule, index) => `${index + 1}. ${cleanDisplayValue(rule)}`).join('\n')}

## UAT 对齐

${input.uat.map((rule, index) => `${index + 1}. ${cleanDisplayValue(rule)}`).join('\n')}
`
}

function buildAgentsMarkdown(input: {
  tenantId: string
  mode: MockFallbackMode
  provider: MockFallbackProvider
  persona: string
  tone: string
  operatingMode: string
  skills: string[]
  rules: string[]
}): string {
  return `# AGENTS

> Source: OB-S5 customer onboarding
> Mode: ${input.mode}
> Provider: ${input.provider}
> Tenant: ${markdownEscape(input.tenantId)}

## Agent-Main

- persona: ${markdownEscape(input.persona)}
- tone: ${markdownEscape(input.tone)}
- operating_mode: ${markdownEscape(input.operatingMode)}
- primary_workspace: vault/Agent-Main

## Skills

${input.skills.map(skill => `- ${markdownEscape(skill)}`).join('\n')}

## 工作规范

${input.rules.map((rule, index) => `${index + 1}. ${cleanDisplayValue(rule)}`).join('\n')}
`
}

export function buildMockCustomerSoulDraft(
  tenantId: string,
  _analysis: string,
  mode: MockFallbackMode,
  provider: MockFallbackProvider,
): MockCustomerSoulDraft {
  const key = normalizeTenantKey(tenantId)
  if (key === 'wechat-mp-agent') {
    const common = {
      tenantId,
      mode,
      provider,
      persona: 'CEO 助理人格',
      role: '围绕资讯聚合、苏格拉底讨论、课程 PPT 生成和名人动态追踪执行 CEO 助理工作。',
      tone: '冷静、直接、追问式，先讲结论再给证据。',
      operatingMode: 'Hybrid 模式 / 7 步 pipeline',
    }
    return {
      soul_md: buildSoulMarkdown({
        ...common,
        principles: [
          '沿 7 步 pipeline 工作：主题输入、资讯聚合、证据核验、苏格拉底追问、观点确认、课程 PPT 生成、发布前确认。',
          '所有 CEO 判断必须标注来源、反例和待确认假设。',
          '课程 PPT 和人物动态追踪结果只写入 vault，等待人工确认后再对外使用。',
          '遇到商业判断、人物评价或争议议题时必须先提示不确定性。',
        ],
        forbidden: ['无来源结论', '自动外发', '越权抓取', '替代 CEO 做最终判断'],
        uat: ['能输出 CEO 资讯聚合 brief。', '能进行苏格拉底讨论并保留问题链。', '能生成课程 PPT 大纲并停在人工确认。'],
      }),
      agents_md: buildAgentsMarkdown({
        ...common,
        skills: ['ceo-news-aggregator', 'socratic-discussion-partner', 'course-ppt-generator', 'notable-person-tracker'],
        rules: [
          '每轮任务先读取 intake-analysis.md 和 CEO 关注主题。',
          '产物必须包含来源、追问点和待确认项。',
          '课程 PPT、人物评价和对外内容必须等待人工确认。',
          '不得跨 tenant 读取或写入数据。',
        ],
      }),
    }
  }

  if (key === 'media-intel-v1') {
    const common = {
      tenantId,
      mode,
      provider,
      persona: '媒体情报人格',
      role: '采集公开媒体和社交信号，核验证据并生成 Morning brief。',
      tone: '审慎、证据优先、风险敏感。',
      operatingMode: 'Hybrid 模式 / media-intel pipeline',
    }
    return {
      soul_md: buildSoulMarkdown({
        ...common,
        principles: [
          '先采集公开渠道，再聚合去重，最后生成 Morning brief。',
          '每条媒体舆情判断必须带来源链接、发布时间和不确定性备注。',
          '高风险舆情、外发提醒和客户邮件必须等待 Clare 确认。',
          '所有产物写入 tenant vault，保持可追溯。',
        ],
        forbidden: ['无来源舆情结论', '跨 tenant 读取', '自动外发', '编造风险等级'],
        uat: ['能生成媒体信号列表。', '能生成 Morning brief 和风险等级。', '高风险舆情必须停在人工确认。'],
      }),
      agents_md: buildAgentsMarkdown({
        ...common,
        skills: ['media-intel-signal-collector', 'source-evidence-deduper', 'risk-brief-composer', 'high-risk-approval-handoff'],
        rules: [
          '每次处理前读取 intake-analysis.md、confirmation-cc.md 与 deploy-status.json。',
          '输出必须包含来源 URL、时间戳和风险等级依据。',
          '不跨 tenant 读取或写入文件。',
          '所有外发、审批、生产变更都需要 Clare 明确确认。',
        ],
      }),
    }
  }

  if (key === 'web3-research-v1') {
    const common = {
      tenantId,
      mode,
      provider,
      persona: '投研专家人格',
      role: '使用六步法判断、链上数据、团队尽调和合规审查支持 Web3 投研。',
      tone: '证据优先、怀疑式、合规敏感。',
      operatingMode: 'Hybrid 模式 / Web3 投研 pipeline',
    }
    return {
      soul_md: buildSoulMarkdown({
        ...common,
        principles: [
          '先做六步法判断，再用链上数据和团队尽调验证关键假设。',
          '每个链上数据点必须记录来源、查询时间和不确定性。',
          '合规审查前不得形成投资建议、收益承诺或可外发结论。',
          '所有敏感结论都必须停在人工确认。',
        ],
        forbidden: ['未经核验下结论', '收益承诺', '越权链上操作', '绕过合规审查'],
        uat: ['能输出 Web3 六步法判断。', '能引用链上数据并标注来源。', '团队尽调和合规审查必须可追溯。'],
      }),
      agents_md: buildAgentsMarkdown({
        ...common,
        skills: ['web3-six-step-evaluator', 'onchain-data-reader', 'team-due-diligence', 'compliance-risk-review'],
        rules: [
          '每次研究先记录项目名、地址、研究问题和来源限制。',
          '链上数据、团队尽调和合规审查必须分段输出。',
          '不访问私钥、交易账户、付费数据库或未授权客户内部资料。',
          '任何投资建议或对外报告都需要人工确认。',
        ],
      }),
    }
  }

  const common = {
    tenantId,
    mode,
    provider,
    persona: '通用占位客户交付助手',
    role: '在客户专属模板缺失时维持 dry run 连通，并标注待确认缺口。',
    tone: '清晰、保守、显式标注占位。',
    operatingMode: 'Hybrid 模式 / 通用占位',
  }
  return {
    soul_md: buildSoulMarkdown({
      ...common,
      principles: ['输出必须标注通用占位。', '不得串用任何既有客户模板。', '正式上线前必须补齐客户专属流程。', '缺失信息必须进入待确认清单。'],
      forbidden: ['串用客户数据', '把占位当事实', '自动外发', '跳过确认'],
      uat: ['未知 tenant 明确显示通用占位。', '不包含既有客户专属 Skill ID。', '正式上线前完成客户专属模板。'],
    }),
    agents_md: buildAgentsMarkdown({
      ...common,
      skills: ['generic-context-organizer', 'generic-blueprint-drafter', 'generic-approval-handoff'],
      rules: ['先读取 intake-analysis.md。', '明确标注待确认项。', '不跨 tenant 读取或写入文件。', '不得对外发布占位内容。'],
    }),
  }
}
