import { describe, expect, it } from 'vitest'

import {
  customerCheckpointNavItems,
  getCustomerCheckpointNavItems,
} from '@/lib/customer-checkpoint-navigation'

describe('customer checkpoint navigation', () => {
  it('starts the onboarding sequence with the three full-flow panels', () => {
    expect(customerCheckpointNavItems.slice(0, 3).map(item => item.label)).toEqual([
      '全景总览',
      '平台就绪',
      '底座选型',
    ])
  })

  it('keeps the customer delivery checkpoints after the setup panels', () => {
    expect(customerCheckpointNavItems.map(item => item.label)).toEqual([
      '全景总览',
      '平台就绪',
      '底座选型',
      'P3 Intake',
      'P4 Blueprint',
      'P5 Approval',
      'P6 Deploy',
      'P7 SOUL/AGENTS',
      'P8 Boundary',
      'P9 Skills 配置',
      'P10 Tests',
      'P11 Hermes',
      'P12 RTS Checklist',
      'P13 Customer View',
      'P14 Channels',
      'P15 UAT',
      'P16 Delivery',
    ])
  })

  it('keeps monitoring support surfaces out of the customer P sequence', () => {
    const labels = customerCheckpointNavItems.map(item => item.label)

    expect(labels).not.toContain('P11 Logs')
    expect(labels).not.toContain('P12 Vault')
    expect(labels).not.toContain('P13 Recall')
    expect(labels).not.toContain('P12 Stuck Alerts')
    expect(labels).not.toContain('P13 Cost / Approvals')
    expect(labels).not.toContain('P14 Alerts Feed')
  })

  it('hides base selection until platform readiness is satisfied', () => {
    expect(getCustomerCheckpointNavItems({ platformReady: false }).map(item => item.id)).not.toContain('base-selection')
    expect(getCustomerCheckpointNavItems({ platformReady: true }).map(item => item.id)).toContain('base-selection')
  })

  it('marks every tenant delivery checkpoint as tenant scoped', () => {
    const scopedPanels = customerCheckpointNavItems
      .filter(item => item.tenantScoped)
      .map(item => item.panel)

    expect(scopedPanels).toEqual([
      'onboarding/overview',
      'onboarding/base-selection',
      'onboarding/customer',
      'onboarding/customer/analyze',
      'onboarding/customer/confirm',
      'onboarding/customer/deploy',
      'onboarding/customer/soul',
      'boundary',
      'onboarding/customer/skills',
      'tests',
      'hermes',
      'delivery',
      'overview',
      'channels',
      'tasks',
      'delivery',
    ])
  })
})
