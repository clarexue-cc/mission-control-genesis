import { describe, expect, it } from 'vitest'

import { customerCheckpointNavItems } from '@/lib/customer-checkpoint-navigation'

describe('customer checkpoint navigation', () => {
  it('shows the full P3-P22 walkthrough sequence in the sidebar', () => {
    expect(customerCheckpointNavItems.map(item => item.label)).toEqual([
      'P3 Intake',
      'P4 Blueprint',
      'P5 Approval',
      'P6 Deploy',
      'P7 SOUL/AGENTS',
      'P8 Boundary',
      'P9 Skills 配置',
      'P10 Tests',
      'P11 Logs',
      'P12 Vault',
      'P13 Recall',
      'P14 Hermes',
      'P15 Stuck Alerts',
      'P16 Cost / Approvals',
      'P17 Alerts Feed',
      'P18 RTS Checklist',
      'P19 Customer View',
      'P20 Channels',
      'P21 UAT',
      'P22 Delivery',
    ])
  })

  it('keeps tenant context on every admin checkpoint that needs it', () => {
    const tenantScoped = customerCheckpointNavItems
      .filter(item => item.tenantScoped)
      .map(item => item.panel)

    expect(tenantScoped).toEqual([
      'onboarding/customer',
      'onboarding/customer/analyze',
      'onboarding/customer/confirm',
      'onboarding/customer/deploy',
      'onboarding/customer/soul',
      'boundary',
      'onboarding/customer/skills',
      'tests',
      'logs',
      'vault',
      'memory',
      'hermes',
      'alerts',
      'cost-tracker',
      'activity',
      'delivery',
      'overview',
      'channels',
      'tasks',
      'delivery',
    ])
  })

  it('uses customer role links for customer-facing checkpoints', () => {
    expect(
      customerCheckpointNavItems
        .filter(item => item.role === 'customer')
        .map(item => ({ label: item.label, panel: item.panel }))
    ).toEqual([
      { label: 'P19 Customer View', panel: 'overview' },
      { label: 'P20 Channels', panel: 'channels' },
      { label: 'P21 UAT', panel: 'tasks' },
      { label: 'P22 Delivery', panel: 'delivery' },
    ])
  })
})
