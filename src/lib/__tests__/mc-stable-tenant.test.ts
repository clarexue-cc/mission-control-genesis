import { describe, expect, it } from 'vitest'

import {
  FIXED_DEV_DEFAULT_TENANT_ID,
  resolveCustomerTenantId,
  resolveDefaultCustomerTenantId,
  resolveStableActiveTenant,
} from '@/lib/mc-stable-mode'

const tenants = [
  { id: 1, slug: 'media-intel-v1', display_name: 'Media Intel' },
  { id: 2, slug: 'ceo-assistant-v1', display_name: 'CEO Assistant' },
  { id: 3, slug: 'web3-research-v1', display_name: 'Web3 Research' },
]

describe('mc stable tenant defaults', () => {
  it('uses ceo-assistant-v1 as the fixed dev preview default tenant', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

    expect(FIXED_DEV_DEFAULT_TENANT_ID).toBe('ceo-assistant-v1')
    expect(resolveDefaultCustomerTenantId(env)).toBe('ceo-assistant-v1')
    expect(resolveCustomerTenantId(new URLSearchParams(), undefined, env)).toBe('ceo-assistant-v1')
  })

  it('lets URL tenant override the fixed default', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

    expect(resolveCustomerTenantId(new URLSearchParams('tenant=media-intel-v1'), undefined, env)).toBe('media-intel-v1')
    expect(resolveCustomerTenantId(new URLSearchParams('tenant_id=web3-research-v1'), undefined, env)).toBe('web3-research-v1')
  })

  it('keeps an explicitly switched tenant after the user changes it', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

    expect(resolveStableActiveTenant({
      tenants,
      storedTenant: tenants[2],
      userSelected: true,
      env,
    })).toEqual(tenants[2])
  })

  it('overrides stale stored tenant when it was not selected under the fixed rule', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

    expect(resolveStableActiveTenant({
      tenants,
      storedTenant: tenants[0],
      userSelected: false,
      env,
    })).toEqual(tenants[1])
  })

  it('preserves production tenant behavior when fixed defaults are disabled', () => {
    const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv

    expect(resolveDefaultCustomerTenantId(env)).toBe('media-intel-v1')
    expect(resolveCustomerTenantId(new URLSearchParams(), undefined, env)).toBe('media-intel-v1')
    expect(resolveStableActiveTenant({
      tenants,
      storedTenant: tenants[0],
      userSelected: false,
      env,
    })).toEqual(tenants[0])
  })
})
