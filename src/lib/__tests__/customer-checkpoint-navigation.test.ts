import { describe, expect, it } from 'vitest'

import { customerCheckpointNavItems } from '@/lib/customer-checkpoint-navigation'

describe('customer checkpoint navigation', () => {
  it('shows only customer delivery checkpoints in the sidebar sequence', () => {
    expect(customerCheckpointNavItems.map(item => item.label)).toEqual([
      'P3 Intake',
      'P4 Blueprint',
      'P5 Approval',
      'P6 Deploy',
      'P7 SOUL/AGENTS',
      'P8 Boundary',
      'P9 Skills 配置',
      'P10 Tests',
      'P11 Hermes',
      'P12 Stuck Alerts',
      'P13 Cost / Approvals',
      'P14 Alerts Feed',
      'P15 RTS Checklist',
      'P16 Customer View',
      'P17 Channels',
      'P18 UAT',
      'P19 Delivery',
    ])
  })

  it('keeps monitoring support surfaces out of the customer P sequence', () => {
    const labels = customerCheckpointNavItems.map(item => item.label)

    expect(labels).not.toContain('P11 Logs')
    expect(labels).not.toContain('P12 Vault')
    expect(labels).not.toContain('P13 Recall')
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
      { label: 'P16 Customer View', panel: 'overview' },
      { label: 'P17 Channels', panel: 'channels' },
      { label: 'P18 UAT', panel: 'tasks' },
      { label: 'P19 Delivery', panel: 'delivery' },
    ])
  })
})
