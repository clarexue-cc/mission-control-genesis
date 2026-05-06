import { describe, expect, it } from 'vitest'

import { buildPanelNavigationHref } from '@/lib/navigation'

describe('panel navigation hrefs', () => {
  it('keeps customer tenant and role context on cron links', () => {
    expect(
      buildPanelNavigationHref('cron', {
        search: '?tenant=ceo-assistant-v1&role=customer',
      })
    ).toBe('/cron?tenant=ceo-assistant-v1&role=customer')
  })

  it('keeps explicit customer checkpoint role on tenant-scoped links', () => {
    expect(
      buildPanelNavigationHref('overview', {
        tenantScoped: true,
        role: 'customer',
        search: '?tenant=ceo-assistant-v1',
      })
    ).toBe('/?tenant=ceo-assistant-v1&role=customer')
  })
})
