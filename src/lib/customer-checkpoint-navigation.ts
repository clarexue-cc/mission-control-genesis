export type CustomerCheckpointRole = 'admin' | 'operator' | 'viewer' | 'customer-user' | 'customer-admin'
export type CustomerCheckpointBase = 'oc' | 'hermes' | 'both'
export type CustomerCheckpointAccess = 'admin' | 'customer' | 'both'

export type CustomerCheckpointPhase =
  | 'setup'
  | 'oc-build'
  | 'hermes-build'
  | 'gate-testing'
  | 'pre-launch'
  | 'delivery'

export interface CustomerCheckpointNavItem {
  id: string
  label: string
  panel: string
  href?: string
  tenantScoped: boolean
  phase: CustomerCheckpointPhase
  description: string
  role?: CustomerCheckpointRole
  base?: Exclude<CustomerCheckpointBase, 'both'>
  access?: CustomerCheckpointAccess
  requiresPlatformReady?: boolean
}

export interface CustomerCheckpointNavOptions {
  platformReady?: boolean
  selectedBase?: CustomerCheckpointBase
}

export const customerCheckpointNavItems: CustomerCheckpointNavItem[] = [
  {
    id: 's1-overview',
    label: 'S1 全景总览',
    panel: 'onboarding/overview',
    tenantScoped: true,
    phase: 'setup',
    description: '查看客户接入全流程、当前阶段、证据面和下一步入口。',
    access: 'both',
  },
  {
    id: 's2-platform-ready',
    label: 'S2 平台就绪',
    panel: 'onboarding/platform-ready',
    tenantScoped: false,
    phase: 'setup',
    description: '确认 Mission Control、phase0、tenant vault、模板和关键 API 是否可用。',
    access: 'admin',
  },
  {
    id: 's3-base-selection',
    label: 'S3 底座选型',
    panel: 'onboarding/base-selection',
    tenantScoped: true,
    phase: 'setup',
    description: '根据客户通道、隔离和交付要求选择 OC、Hermes 或双底座。',
    requiresPlatformReady: true,
    access: 'both',
  },
  {
    id: 's4-intake',
    label: 'S4 客户接入',
    panel: 'onboarding/customer',
    href: '/onboarding/customer',
    tenantScoped: true,
    phase: 'setup',
    description: '收集客户访谈、原始需求和业务上下文，作为 OC 与 Hermes 的共同输入。',
    access: 'admin',
  },
  {
    id: 'p1-blueprint',
    label: 'P1 蓝图',
    panel: 'onboarding/customer/analyze',
    href: '/onboarding/customer/analyze',
    tenantScoped: true,
    phase: 'oc-build',
    description: '生成客户方案蓝图、约束和验收口径。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p2-approval',
    label: 'P2 审批',
    panel: 'onboarding/customer/confirm',
    href: '/onboarding/customer/confirm',
    tenantScoped: true,
    phase: 'oc-build',
    description: '让 Clare 审阅确认方案，保存批准或退回意见。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p3-deploy',
    label: 'P3 部署',
    panel: 'onboarding/customer/deploy',
    href: '/onboarding/customer/deploy',
    tenantScoped: true,
    phase: 'oc-build',
    description: '创建 workspace、tenant 目录和基础运行配置。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p4-soul-agents',
    label: 'P4 SOUL/AGENTS',
    panel: 'onboarding/customer/soul',
    href: '/onboarding/customer/soul',
    tenantScoped: true,
    phase: 'oc-build',
    description: '生成 SOUL、AGENTS 和客户专属工作标准。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p5-boundary',
    label: 'P5 边界',
    panel: 'boundary',
    tenantScoped: true,
    phase: 'oc-build',
    description: '配置客户边界规则和硬控制。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p6-skills',
    label: 'P6 技能配置',
    panel: 'onboarding/customer/skills',
    href: '/onboarding/customer/skills',
    tenantScoped: true,
    phase: 'oc-build',
    description: '绑定客户交付所需技能、运行手册和工具入口。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p7-gate-testing',
    label: 'P7 闸门测试',
    panel: 'onboarding/gate-testing',
    tenantScoped: true,
    phase: 'gate-testing',
    description: '统一查看 Dry Run、Integration、E2E 三道闸门和测试证据。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p8-pre-launch',
    label: 'P8 OC 上线准备',
    panel: 'onboarding/pre-launch',
    tenantScoped: true,
    phase: 'pre-launch',
    description: '整合 RTS、客户视图和 OC 渠道上线检查。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p9-delivery',
    label: 'P9 验收交付',
    panel: 'onboarding/delivery',
    tenantScoped: true,
    phase: 'delivery',
    role: 'customer-admin',
    description: '汇总 UAT、交付报告、配置移交和运维 SOP。',
    base: 'oc',
    access: 'both',
  },
  {
    id: 'h1-blueprint',
    label: 'H1 蓝图',
    panel: 'onboarding/hermes/blueprint',
    href: '/onboarding/hermes/blueprint',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '从 S4 intake 生成 Hermes profile 结构蓝图。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h2-approval',
    label: 'H2 审批',
    panel: 'onboarding/hermes/approval',
    href: '/onboarding/hermes/approval',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '让 Clare 审阅确认 Hermes 蓝图，保存批准或退回意见。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h3-deploy',
    label: 'H3 部署配置',
    panel: 'onboarding/hermes/deploy',
    href: '/onboarding/hermes/deploy',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '生成 config.yaml、harness-meta 和客户 vault 初始化配置。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h4-identity',
    label: 'H4 核心身份',
    panel: 'onboarding/customer/soul',
    href: '/onboarding/customer/soul',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '复用双底座 SOUL 页面，定稿 Hermes SOUL、USER 和 MEMORY。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h5-skills',
    label: 'H5 Skills 填充',
    panel: 'onboarding/hermes/skills',
    href: '/onboarding/hermes/skills',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '定义 Hermes 交付所需的 SKILL.md 文件。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h6-governance-config',
    label: 'H6 治理配置',
    panel: 'onboarding/hermes/governance-config',
    href: '/onboarding/hermes/governance-config',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '配置 cron-schedule、approved-skills、boundary 和 output-checker。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h7-governance-verify',
    label: 'H7 治理验证',
    panel: 'onboarding/hermes/governance-verify',
    href: '/onboarding/hermes/governance-verify',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '串联现有 Hermes 运维面板逐项验证治理配置。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h8-gate-tests',
    label: 'H8 闸门测试',
    panel: 'onboarding/hermes/gate-tests',
    href: '/onboarding/hermes/gate-tests',
    tenantScoped: true,
    phase: 'gate-testing',
    description: '运行 Golden、Adversarial 和 Hermes 专项测试。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h9-guardian',
    label: 'H9 Guardian 配置',
    panel: 'onboarding/hermes/guardian',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '复用 Guardian 面板验证 gateway 健康、profile 恢复、halt 信号和 token 预算。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h10-rts',
    label: 'H10 Hermes 上线',
    panel: 'onboarding/hermes/rts',
    href: '/onboarding/hermes/rts',
    tenantScoped: true,
    phase: 'pre-launch',
    description: '执行 Hermes Ready-to-Ship checklist。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h11-delivery',
    label: 'H11 验收交付',
    panel: 'onboarding/hermes/delivery',
    href: '/onboarding/hermes/delivery',
    tenantScoped: true,
    phase: 'delivery',
    role: 'customer-admin',
    description: '汇总 Hermes UAT、打包和交付材料。',
    base: 'hermes',
    access: 'both',
  },
]

export function getCustomerCheckpointNavItems(
  options: CustomerCheckpointNavOptions = {},
): CustomerCheckpointNavItem[] {
  const { selectedBase } = options
  if (selectedBase === 'both') {
    return customerCheckpointNavItems
  }
  if (!selectedBase) {
    return customerCheckpointNavItems.filter(item => !item.base)
  }
  return customerCheckpointNavItems.filter(item => !item.base || item.base === selectedBase)
}
