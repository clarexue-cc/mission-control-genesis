import { describe, expect, it } from 'vitest'

import { CUSTOMER_VISIBLE_PANELS, canAccessPanel } from '@/lib/rbac'

describe('customer RBAC panel access', () => {
  const customerVisiblePanels = [
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
  ] as const

  it('allows customers to access the visible panel whitelist', () => {
    expect(CUSTOMER_VISIBLE_PANELS).toEqual(customerVisiblePanels)
    for (const panel of customerVisiblePanels) {
      expect(canAccessPanel('customer', panel)).toBe(true)
    }
  })

  it('blocks customers from admin-only panels', () => {
    const adminOnlyPanels = [
      'boundary',
      'test-console',
      'tests',
      'super-admin',
      'user-management',
      'users',
      'debug',
      'vault',
      'security-audit',
      'security',
    ]

    for (const panel of adminOnlyPanels) {
      expect(canAccessPanel('customer', panel)).toBe(false)
    }
  })
})
