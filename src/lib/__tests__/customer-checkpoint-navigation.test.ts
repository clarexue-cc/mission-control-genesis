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

  it('defines the complete six-stage target navigation', () => {
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
      'H-01 Profile Setup',
      'H-02 Boundary Watchdog',
      'H-03 Skill Curator',
      'H-04 Memory Curator',
      'H-05 Output Checker',
      'H-06 Guardian',
      'H-07 Cron 治理',
      '阶段 3：闸门测试',
      '阶段 4：上线准备',
      '阶段 5-6：验收交付',
    ])
  })

  it('keeps old monitoring and flattened P10-P16 surfaces out of the customer sequence', () => {
    const labels = customerCheckpointNavItems.map(item => item.label)

    expect(labels).not.toContain('P11 Logs')
    expect(labels).not.toContain('P12 Vault')
    expect(labels).not.toContain('P13 Recall')
    expect(labels).not.toContain('P12 Stuck Alerts')
    expect(labels).not.toContain('P13 Cost / Approvals')
    expect(labels).not.toContain('P14 Alerts Feed')
    expect(labels).not.toContain('P10 Tests')
    expect(labels).not.toContain('P11 Hermes')
    expect(labels).not.toContain('P12 RTS Checklist')
    expect(labels).not.toContain('P16 Delivery')
  })

  it('hides base selection until platform readiness is satisfied', () => {
    expect(getCustomerCheckpointNavItems({ platformReady: false }).map(item => item.id)).not.toContain('base-selection')
    expect(getCustomerCheckpointNavItems({ platformReady: true }).map(item => item.id)).toContain('base-selection')
  })

  it('hides base-specific build paths before a base is selected', () => {
    const ids = getCustomerCheckpointNavItems({ platformReady: true }).map(item => item.id)

    expect(ids).toContain('onboarding-overview')
    expect(ids).toContain('base-selection')
    expect(ids).toContain('gate-testing')
    expect(ids).toContain('pre-launch')
    expect(ids).toContain('onboarding-delivery')
    expect(ids).not.toContain('p3-intake')
    expect(ids).not.toContain('h01-profile-setup')
  })

  it('shows only the OC build path for OC tenants', () => {
    const ids = getCustomerCheckpointNavItems({
      platformReady: true,
      selectedBase: 'oc',
    }).map(item => item.id)

    expect(ids).toContain('p3-intake')
    expect(ids).toContain('p9-skills')
    expect(ids).not.toContain('h01-profile-setup')
    expect(ids).toContain('gate-testing')
    expect(ids).toContain('onboarding-delivery')
  })

  it('points OC page-route checkpoints at the real /onboarding/customer routes', () => {
    const hrefById = new Map(
      customerCheckpointNavItems
        .filter(item => item.base === 'oc' && item.panel.startsWith('onboarding/customer'))
        .map(item => [item.id, item.href]),
    )

    expect(Object.fromEntries(hrefById)).toEqual({
      'p3-intake': '/onboarding/customer',
      'p4-blueprint': '/onboarding/customer/analyze',
      'p5-approval': '/onboarding/customer/confirm',
      'p6-deploy': '/onboarding/customer/deploy',
      'p7-soul-agents': '/onboarding/customer/soul',
      'p9-skills': '/onboarding/customer/skills',
    })
  })

  it('shows only the Hermes build path for Hermes tenants', () => {
    const ids = getCustomerCheckpointNavItems({
      platformReady: true,
      selectedBase: 'hermes',
    }).map(item => item.id)

    expect(ids).toContain('h01-profile-setup')
    expect(ids).toContain('h07-cron-governance')
    expect(ids).not.toContain('p3-intake')
    expect(ids).toContain('gate-testing')
    expect(ids).toContain('onboarding-delivery')
  })

  it('shows both build paths for dual-base tenants', () => {
    const ids = getCustomerCheckpointNavItems({
      platformReady: true,
      selectedBase: 'both',
    }).map(item => item.id)

    expect(ids).toContain('p3-intake')
    expect(ids).toContain('p9-skills')
    expect(ids).toContain('h01-profile-setup')
    expect(ids).toContain('h07-cron-governance')
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
      'onboarding/hermes/profile',
      'onboarding/hermes/boundary',
      'onboarding/hermes/skills',
      'onboarding/hermes/memory',
      'onboarding/hermes/output',
      'onboarding/hermes/guardian',
      'onboarding/hermes/cron',
      'onboarding/gate-testing',
      'onboarding/pre-launch',
      'onboarding/delivery',
    ])
  })
})
