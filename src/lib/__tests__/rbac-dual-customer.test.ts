import { describe, expect, it } from 'vitest'

import { PANEL_ACCESS_BY_ROLE, canAccessPanel } from '@/lib/rbac'

describe('dual customer RBAC roles', () => {
  const customerAdminPanels = [
    'overview',
    'agents',
    'tasks',
    'delivery',
    'cost-tracker',
    'channels',
    'alerts',
    'settings',
    'integrations',
    'cron',
    'skills',
  ]

  const customerUserPanels = [
    'overview',
    'agents',
    'tasks',
    'channels',
    'alerts',
    'skills',
  ]

  it('allows customer-admin into the 11 customer admin panels and blocks admin-only panels', () => {
    expect(PANEL_ACCESS_BY_ROLE['customer-admin']).toEqual(customerAdminPanels)
    for (const panel of customerAdminPanels) {
      expect(canAccessPanel('customer-admin', panel)).toBe(true)
    }

    for (const panel of ['boundary', 'test-console', 'tests', 'security-audit', 'vault']) {
      expect(canAccessPanel('customer-admin', panel)).toBe(false)
    }
  })

  it('allows customer-user into 6 read panels and blocks the rest', () => {
    expect(PANEL_ACCESS_BY_ROLE['customer-user']).toEqual(customerUserPanels)
    for (const panel of customerUserPanels) {
      expect(canAccessPanel('customer-user', panel)).toBe(true)
    }

    for (const panel of ['delivery', 'cost-tracker', 'settings', 'integrations', 'cron', 'boundary']) {
      expect(canAccessPanel('customer-user', panel)).toBe(false)
    }
  })

  it('allows admin into every panel string', () => {
    for (const panel of ['overview', 'boundary', 'test-console', 'users', 'anything-new']) {
      expect(canAccessPanel('admin', panel)).toBe(true)
    }
  })
})
