import { describe, expect, it } from 'vitest'

import { buildPanelNavigationHref } from '@/lib/navigation'

describe('panel navigation hrefs', () => {
  it('keeps customer tenant and role context on cron links', () => {
    expect(
      buildPanelNavigationHref('cron', {
        search: '?tenant=wechat-mp-agent&role=customer',
      })
    ).toBe('/cron?tenant=wechat-mp-agent&role=customer')
  })

  it('keeps explicit customer checkpoint role on tenant-scoped links', () => {
    expect(
      buildPanelNavigationHref('overview', {
        tenantScoped: true,
        role: 'customer',
        search: '?tenant=wechat-mp-agent',
      })
    ).toBe('/?tenant=wechat-mp-agent&role=customer')
  })
})
