import { describe, expect, it } from 'vitest'

import {
  isNavigationItemHiddenByInterfaceMode,
  resolveEffectiveInterfaceMode,
  resolveInitialSidebarExpanded,
  resolveNextSidebarExpanded,
  shouldShowInterfaceModeSwitcher,
} from '@/lib/mc-stable-mode'

describe('mc stable navigation mode', () => {
  it('forces full navigation in development even when the stored mode is essential', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

    expect(resolveEffectiveInterfaceMode('essential', env)).toBe('full')
    expect(isNavigationItemHiddenByInterfaceMode({ essential: false }, 'essential', env)).toBe(false)
    expect(isNavigationItemHiddenByInterfaceMode({}, 'essential', env)).toBe(false)
  })

  it('forces full navigation when MC_NAV_FIXED is enabled for preview', () => {
    const env = { NODE_ENV: 'production', MC_NAV_FIXED: 'true' } as NodeJS.ProcessEnv

    expect(resolveEffectiveInterfaceMode('essential', env)).toBe('full')
    expect(isNavigationItemHiddenByInterfaceMode({ essential: false }, 'essential', env)).toBe(false)
  })

  it('keeps production essential filtering available when fixed navigation is not enabled', () => {
    const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv

    expect(resolveEffectiveInterfaceMode('essential', env)).toBe('essential')
    expect(isNavigationItemHiddenByInterfaceMode({ essential: false }, 'essential', env)).toBe(true)
    expect(isNavigationItemHiddenByInterfaceMode({ essential: true }, 'essential', env)).toBe(false)
  })

  it('hides the interface mode switcher during fixed dev navigation but keeps it for production admins', () => {
    expect(shouldShowInterfaceModeSwitcher(true, { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false)
    expect(shouldShowInterfaceModeSwitcher(true, { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true)
    expect(shouldShowInterfaceModeSwitcher(false, { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false)
  })

  it('keeps the sidebar expanded during fixed dev navigation', () => {
    const fixedEnv = { NODE_ENV: 'production', NEXT_PUBLIC_MC_NAV_FIXED: 'true' } as NodeJS.ProcessEnv
    const productionEnv = { NODE_ENV: 'production' } as NodeJS.ProcessEnv

    expect(resolveInitialSidebarExpanded(null, fixedEnv)).toBe(true)
    expect(resolveInitialSidebarExpanded('false', fixedEnv)).toBe(true)
    expect(resolveNextSidebarExpanded(false, fixedEnv)).toBe(true)
    expect(resolveNextSidebarExpanded(true, fixedEnv)).toBe(true)
    expect(resolveInitialSidebarExpanded('false', productionEnv)).toBe(false)
    expect(resolveNextSidebarExpanded(true, productionEnv)).toBe(false)
  })
})
