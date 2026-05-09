export type CustomerCheckpointRole = 'admin' | 'operator' | 'viewer' | 'customer-user' | 'customer-admin'

export type CustomerCheckpointPhase =
  | 'setup'
  | 'delivery-admin'
  | 'delivery-customer'

export interface CustomerCheckpointNavItem {
  id: string
  label: string
  panel: string
  tenantScoped: boolean
  phase: CustomerCheckpointPhase
  description: string
  role?: CustomerCheckpointRole
  requiresPlatformReady?: boolean
}

export interface CustomerCheckpointNavOptions {
  platformReady?: boolean
}

export const customerCheckpointNavItems: CustomerCheckpointNavItem[] = [
  {
    id: 'onboarding-overview',
    label: '全景总览',
    panel: 'onboarding/overview',
    tenantScoped: true,
    phase: 'setup',
    description: '查看客户接入全流程、当前阶段、证据面和下一步入口。',
  },
  {
    id: 'platform-ready',
    label: '平台就绪',
    panel: 'onboarding/platform-ready',
    tenantScoped: false,
    phase: 'setup',
    description: '确认 Mission Control、phase0、tenant vault、模板和关键 API 是否可用。',
  },
  {
    id: 'base-selection',
    label: '底座选型',
    panel: 'onboarding/base-selection',
    tenantScoped: true,
    phase: 'setup',
    description: '根据客户通道、隔离和交付要求选择共享底座、专属底座或模板底座。',
    requiresPlatformReady: true,
  },
  {
    id: 'p3-intake',
    label: 'P3 Intake',
    panel: 'onboarding/customer',
    tenantScoped: true,
    phase: 'delivery-admin',
    description: '收集客户访谈、原始需求和业务上下文。',
  },
  {
    id: 'p4-blueprint',
    label: 'P4 Blueprint',
    panel: 'onboarding/customer/analyze',
    tenantScoped: true,
    phase: 'delivery-admin',
    description: '生成客户方案蓝图、约束和验收口径。',
  },
  {
    id: 'p5-approval',
    label: 'P5 Approval',
    panel: 'onboarding/customer/confirm',
    tenantScoped: true,
    phase: 'delivery-admin',
    description: '让 Clare 审阅确认方案，保存批准或退回意见。',
  },
  {
    id: 'p6-deploy',
    label: 'P6 Deploy',
    panel: 'onboarding/customer/deploy',
    tenantScoped: true,
    phase: 'delivery-admin',
    description: '创建 workspace、tenant 目录和基础运行配置。',
  },
  {
    id: 'p7-soul-agents',
    label: 'P7 SOUL/AGENTS',
    panel: 'onboarding/customer/soul',
    tenantScoped: true,
    phase: 'delivery-admin',
    description: '生成 SOUL、AGENTS 和客户专属工作标准。',
  },
  {
    id: 'p8-boundary',
    label: 'P8 Boundary',
    panel: 'boundary',
    tenantScoped: true,
    phase: 'delivery-admin',
    description: '配置客户边界规则和硬控制。',
  },
  {
    id: 'p9-skills',
    label: 'P9 Skills 配置',
    panel: 'onboarding/customer/skills',
    tenantScoped: true,
    phase: 'delivery-admin',
    description: '绑定客户交付所需技能、运行手册和工具入口。',
  },
  {
    id: 'p10-tests',
    label: 'P10 Tests',
    panel: 'tests',
    tenantScoped: true,
    phase: 'delivery-admin',
    description: '运行 golden、adversarial、drift 和 UAT 前置测试。',
  },
  {
    id: 'p11-hermes',
    label: 'P11 Hermes',
    panel: 'hermes',
    tenantScoped: true,
    phase: 'delivery-admin',
    description: '检查 Hermes 监控证据、心跳和客户运行观察面。',
  },
  {
    id: 'p12-rts-checklist',
    label: 'P12 RTS Checklist',
    panel: 'delivery',
    tenantScoped: true,
    phase: 'delivery-admin',
    description: '确认 ready-to-ship checklist、交付阻塞和证据完整性。',
  },
  {
    id: 'p13-customer-view',
    label: 'P13 Customer View',
    panel: 'overview',
    tenantScoped: true,
    phase: 'delivery-customer',
    role: 'customer-user',
    description: '切到客户视角检查他们会看到的首页。',
  },
  {
    id: 'p14-channels',
    label: 'P14 Channels',
    panel: 'channels',
    tenantScoped: true,
    phase: 'delivery-customer',
    role: 'customer-user',
    description: '验证客户通道入口、连接状态和暴露信息。',
  },
  {
    id: 'p15-uat',
    label: 'P15 UAT',
    panel: 'tasks',
    tenantScoped: true,
    phase: 'delivery-customer',
    role: 'customer-user',
    description: '客户 UAT 任务面和验收记录。',
  },
  {
    id: 'p16-delivery',
    label: 'P16 Delivery',
    panel: 'delivery',
    tenantScoped: true,
    phase: 'delivery-customer',
    role: 'customer-admin',
    description: '客户管理员交付视图和最终交接状态。',
  },
]

export function getCustomerCheckpointNavItems(
  options: CustomerCheckpointNavOptions = {},
): CustomerCheckpointNavItem[] {
  return customerCheckpointNavItems.filter(item => {
    if (item.requiresPlatformReady && options.platformReady === false) return false
    return true
  })
}
