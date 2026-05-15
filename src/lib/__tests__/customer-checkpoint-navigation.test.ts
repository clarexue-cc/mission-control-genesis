import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  customerCheckpointNavItems,
  getCustomerCheckpointNavItems,
} from '@/lib/customer-checkpoint-navigation'

describe('customer checkpoint navigation', () => {
  it('starts the onboarding sequence with the shared S-series panels', () => {
    expect(customerCheckpointNavItems.slice(0, 4).map(item => item.label)).toEqual([
      'S1 全景总览',
      'S2 平台就绪',
      'S3 底座选型',
      'S4 客户接入',
    ])
  })

  it('defines the complete S/P/H target navigation', () => {
    expect(customerCheckpointNavItems.map(item => item.label)).toEqual([
      'S1 全景总览',
      'S2 平台就绪',
      'S3 底座选型',
      'S4 客户接入',
      'P1 蓝图',
      'P2 审批',
      'P3 部署',
      'P4 SOUL/AGENTS',
      'P5 边界',
      'P6 技能配置',
      'P7 闸门测试',
      'P8 OC 上线准备',
      'P9 验收交付',
      'H1 蓝图',
      'H2 审批',
      'H3 部署配置',
      'H4 核心身份',
      'H5 Skills 填充',
      'H6 治理配置',
      'H7 治理验证',
      'H8 闸门测试',
      'H9 Guardian 配置',
      'H10 Hermes 上线',
      'H11 验收交付',
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

  it('shows only shared S-series before a base is selected', () => {
    const ids = getCustomerCheckpointNavItems({ platformReady: true }).map(item => item.id)

    expect(ids).toEqual(['s1-overview', 's2-platform-ready', 's3-base-selection', 's4-intake'])
  })

  it('shows only the OC build path for OC tenants', () => {
    const ids = getCustomerCheckpointNavItems({
      platformReady: true,
      selectedBase: 'oc',
    }).map(item => item.id)

    expect(ids).toEqual([
      's1-overview',
      's2-platform-ready',
      's3-base-selection',
      's4-intake',
      'p1-blueprint',
      'p2-approval',
      'p3-deploy',
      'p4-soul-agents',
      'p5-boundary',
      'p6-skills',
      'p7-gate-testing',
      'p8-pre-launch',
      'p9-delivery',
    ])
  })

  it('points OC page-route checkpoints at the real /onboarding/customer routes', () => {
    const hrefById = new Map(
      customerCheckpointNavItems
        .filter(item => (!item.base || item.base === 'oc') && item.panel.startsWith('onboarding/customer'))
        .map(item => [item.id, item.href]),
    )

    expect(Object.fromEntries(hrefById)).toEqual({
      's4-intake': '/onboarding/customer',
      'p1-blueprint': '/onboarding/customer/analyze',
      'p2-approval': '/onboarding/customer/confirm',
      'p3-deploy': '/onboarding/customer/deploy',
      'p4-soul-agents': '/onboarding/customer/soul',
      'p6-skills': '/onboarding/customer/skills',
    })
  })

  it('shows only the Hermes build path for Hermes tenants', () => {
    const ids = getCustomerCheckpointNavItems({
      platformReady: true,
      selectedBase: 'hermes',
    }).map(item => item.id)

    expect(ids).toEqual([
      's1-overview',
      's2-platform-ready',
      's3-base-selection',
      's4-intake',
      'h1-blueprint',
      'h2-approval',
      'h3-deploy',
      'h4-identity',
      'h5-skills',
      'h6-governance-config',
      'h7-governance-verify',
      'h8-gate-tests',
      'h9-guardian',
      'h10-rts',
      'h11-delivery',
    ])
  })

  it('shows both build paths for dual-base tenants', () => {
    const ids = getCustomerCheckpointNavItems({
      platformReady: true,
      selectedBase: 'both',
    }).map(item => item.id)

    expect(ids).toContain('p1-blueprint')
    expect(ids).toContain('p9-delivery')
    expect(ids).toContain('h1-blueprint')
    expect(ids).toContain('h11-delivery')
  })

  it('marks every customer checkpoint except platform readiness as tenant scoped', () => {
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
      'onboarding/gate-testing',
      'onboarding/pre-launch',
      'onboarding/delivery',
      'onboarding/hermes/blueprint',
      'onboarding/hermes/approval',
      'onboarding/hermes/deploy',
      'onboarding/customer/soul',
      'onboarding/hermes/skills',
      'onboarding/hermes/governance-config',
      'onboarding/hermes/governance-verify',
      'onboarding/hermes/gate-tests',
      'onboarding/hermes/guardian',
      'onboarding/hermes/rts',
      'onboarding/hermes/delivery',
    ])
  })

  it('creates placeholder pages for new Hermes build checkpoints', () => {
    const repoRoot = process.cwd()
    const expectedPages = [
      ['src/app/onboarding/hermes/blueprint/page.tsx', 'H1 蓝图 Blueprint'],
      ['src/app/onboarding/hermes/approval/page.tsx', 'H2 审批 Approval'],
      ['src/app/onboarding/hermes/deploy/page.tsx', 'H3 部署配置 Deploy'],
      ['src/app/onboarding/hermes/skills/page.tsx', 'H5 Skills 填充'],
      ['src/app/onboarding/hermes/governance-config/page.tsx', 'H6 治理配置'],
      ['src/app/onboarding/hermes/governance-verify/page.tsx', 'H7 治理验证'],
      ['src/app/onboarding/hermes/gate-tests/page.tsx', 'H8 闸门测试'],
      ['src/app/onboarding/hermes/rts/page.tsx', 'H10 Hermes 上线'],
      ['src/app/onboarding/hermes/delivery/page.tsx', 'H11 验收交付'],
    ] as const

    for (const [relativePath, heading] of expectedPages) {
      const absolutePath = path.join(repoRoot, relativePath)
      expect(existsSync(absolutePath)).toBe(true)
      expect(readFileSync(absolutePath, 'utf8')).toContain(heading)
    }
  })
})
