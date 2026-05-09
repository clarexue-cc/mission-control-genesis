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
    id: 'onboarding-overview',
    label: '全景总览',
    panel: 'onboarding/overview',
    tenantScoped: true,
    phase: 'setup',
    description: '查看客户接入全流程、当前阶段、证据面和下一步入口。',
    access: 'both',
  },
  {
    id: 'platform-ready',
    label: '平台就绪',
    panel: 'onboarding/platform-ready',
    tenantScoped: false,
    phase: 'setup',
    description: '确认 Mission Control、phase0、tenant vault、模板和关键 API 是否可用。',
    access: 'admin',
  },
  {
    id: 'base-selection',
    label: '底座选型',
    panel: 'onboarding/base-selection',
    tenantScoped: true,
    phase: 'setup',
    description: '根据客户通道、隔离和交付要求选择 OC、Hermes 或双底座。',
    requiresPlatformReady: true,
    access: 'both',
  },
  {
    id: 'p3-intake',
    label: 'P3 Intake',
    panel: 'onboarding/customer',
    tenantScoped: true,
    phase: 'oc-build',
    description: '收集客户访谈、原始需求和业务上下文。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p4-blueprint',
    label: 'P4 Blueprint',
    panel: 'onboarding/customer/analyze',
    tenantScoped: true,
    phase: 'oc-build',
    description: '生成客户方案蓝图、约束和验收口径。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p5-approval',
    label: 'P5 Approval',
    panel: 'onboarding/customer/confirm',
    tenantScoped: true,
    phase: 'oc-build',
    description: '让 Clare 审阅确认方案，保存批准或退回意见。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p6-deploy',
    label: 'P6 Deploy',
    panel: 'onboarding/customer/deploy',
    tenantScoped: true,
    phase: 'oc-build',
    description: '创建 workspace、tenant 目录和基础运行配置。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p7-soul-agents',
    label: 'P7 SOUL/AGENTS',
    panel: 'onboarding/customer/soul',
    tenantScoped: true,
    phase: 'oc-build',
    description: '生成 SOUL、AGENTS 和客户专属工作标准。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p8-boundary',
    label: 'P8 Boundary',
    panel: 'boundary',
    tenantScoped: true,
    phase: 'oc-build',
    description: '配置客户边界规则和硬控制。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'p9-skills',
    label: 'P9 Skills 配置',
    panel: 'onboarding/customer/skills',
    tenantScoped: true,
    phase: 'oc-build',
    description: '绑定客户交付所需技能、运行手册和工具入口。',
    base: 'oc',
    access: 'admin',
  },
  {
    id: 'h01-profile-setup',
    label: 'H-01 Profile Setup',
    panel: 'onboarding/hermes/profile',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '从 intake 生成 Hermes profile、config、SOUL、skills、cron 和 gateway 验证。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h02-boundary-watchdog',
    label: 'H-02 Boundary Watchdog',
    panel: 'onboarding/hermes/boundary',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '配置 Hermes 输出边界 watchdog，检查 forbidden 和 drift 触发。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h03-skill-curator',
    label: 'H-03 Skill Curator',
    panel: 'onboarding/hermes/skills',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '管理 Hermes 技能白名单、pin、快照、恢复和审计。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h04-memory-curator',
    label: 'H-04 Memory Curator',
    panel: 'onboarding/hermes/memory',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '审计 memories、精选核心记忆并检查跨 profile 隔离。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h05-output-checker',
    label: 'H-05 Output Checker',
    panel: 'onboarding/hermes/output',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '检查 Hermes 输出格式、敏感信息、来源和身份一致性。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h06-guardian',
    label: 'H-06 Guardian',
    panel: 'onboarding/hermes/guardian',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '验证 gateway 健康、profile 恢复、halt 信号和 token 预算。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'h07-cron-governance',
    label: 'H-07 Cron 治理',
    panel: 'onboarding/hermes/cron',
    tenantScoped: true,
    phase: 'hermes-build',
    description: '治理 Hermes cron 审批、日志、告警和 token 成本。',
    base: 'hermes',
    access: 'admin',
  },
  {
    id: 'gate-testing',
    label: '阶段 3：闸门测试',
    panel: 'onboarding/gate-testing',
    tenantScoped: true,
    phase: 'gate-testing',
    description: '统一查看 Dry Run、Integration、E2E 三道闸门和测试证据。',
    access: 'admin',
  },
  {
    id: 'pre-launch',
    label: '阶段 4：上线准备',
    panel: 'onboarding/pre-launch',
    tenantScoped: true,
    phase: 'pre-launch',
    description: '整合 RTS、客户视图、Hermes 守护和渠道上线检查。',
    access: 'admin',
  },
  {
    id: 'onboarding-delivery',
    label: '阶段 5-6：验收交付',
    panel: 'onboarding/delivery',
    tenantScoped: true,
    phase: 'delivery',
    role: 'customer-admin',
    description: '汇总 UAT、交付报告、配置移交和运维 SOP。',
    access: 'both',
  },
]

export function getCustomerCheckpointNavItems(
  options: CustomerCheckpointNavOptions = {},
): CustomerCheckpointNavItem[] {
  return customerCheckpointNavItems.filter(item => {
    if (item.requiresPlatformReady && options.platformReady === false) return false
    if (!item.base) return true
    if (!options.selectedBase) return false
    if (options.selectedBase === 'both') return true
    if (item.base !== options.selectedBase) return false
    return true
  })
}
