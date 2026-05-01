import { describe, expect, it } from 'vitest'

import { customerCheckpointNavItems } from '@/lib/customer-checkpoint-navigation'

describe('customer checkpoint navigation', () => {
  it('shows the customer walkthrough without evidence-only log and vault pages as phases', () => {
    expect(customerCheckpointNavItems.map(item => item.label)).toEqual([
      'P3 Intake',
      'P4 Blueprint',
      'P5 Approval',
      'P6 Deploy',
      'P7 SOUL/AGENTS',
      'P8 Boundary',
      'P9 Skills 配置',
      'P10 Tests',
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

  it('keeps evidence/debug viewers out of the customer checkpoint sequence', () => {
    expect(customerCheckpointNavItems.map(item => item.panel)).not.toContain('logs')
    expect(customerCheckpointNavItems.map(item => item.panel)).not.toContain('vault')
    expect(customerCheckpointNavItems.map(item => item.panel)).not.toContain('memory')
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
