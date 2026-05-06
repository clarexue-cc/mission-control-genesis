import { describe, expect, it } from 'vitest'

import { canAccessPanel } from '@/lib/rbac'

describe('customer RBAC', () => {
  it('allows customer view to open the P16 delivery page', () => {
    expect(canAccessPanel('customer', 'delivery')).toBe(true)
  })
})
