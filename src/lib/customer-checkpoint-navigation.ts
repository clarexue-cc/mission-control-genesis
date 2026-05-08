import type { EffectiveRole } from '@/lib/rbac'

export interface CustomerCheckpointNavItem {
  id: string
  label: string
  panel: string
  tenantScoped: boolean
  role?: EffectiveRole
}

export const customerCheckpointNavItems: CustomerCheckpointNavItem[] = [
  { id: 'p3-intake', label: 'P3 Intake', panel: 'onboarding/customer', tenantScoped: true },
  { id: 'p4-blueprint', label: 'P4 Blueprint', panel: 'onboarding/customer/analyze', tenantScoped: true },
  { id: 'p5-approval', label: 'P5 Approval', panel: 'onboarding/customer/confirm', tenantScoped: true },
  { id: 'p6-deploy', label: 'P6 Deploy', panel: 'onboarding/customer/deploy', tenantScoped: true },
  { id: 'p7-soul-agents', label: 'P7 SOUL/AGENTS', panel: 'onboarding/customer/soul', tenantScoped: true },
  { id: 'p8-boundary', label: 'P8 Boundary', panel: 'boundary', tenantScoped: true },
  { id: 'p9-skills', label: 'P9 Skills 配置', panel: 'onboarding/customer/skills', tenantScoped: true },
  { id: 'p10-tests', label: 'P10 Tests', panel: 'tests', tenantScoped: true },
  { id: 'p11-hermes', label: 'P11 Hermes', panel: 'hermes', tenantScoped: true },
  { id: 'p12-rts-checklist', label: 'P12 RTS Checklist', panel: 'delivery', tenantScoped: true },
  { id: 'p13-customer-view', label: 'P13 Customer View', panel: 'overview', tenantScoped: true, role: 'customer-user' },
  { id: 'p14-channels', label: 'P14 Channels', panel: 'channels', tenantScoped: true, role: 'customer-user' },
  { id: 'p15-uat', label: 'P15 UAT', panel: 'tasks', tenantScoped: true, role: 'customer-user' },
  { id: 'p16-delivery', label: 'P16 Delivery', panel: 'delivery', tenantScoped: true, role: 'customer-admin' },
]
