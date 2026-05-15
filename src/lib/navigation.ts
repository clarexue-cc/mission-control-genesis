'use client'

import { useRouter, usePathname } from 'next/navigation'
import { startTransition, useCallback, useEffect } from 'react'
import { startNavigationTiming } from '@/lib/navigation-metrics'
import { useMissionControl } from '@/store'
import { resolveCustomerTenantId } from '@/lib/mc-stable-mode'

export function panelHref(panel: string): string {
  if (panel === 'boundary') return '/panels/boundary'
  return panel === 'overview' ? '/' : `/${panel}`
}

export function buildPanelNavigationHref(
  panel: string,
  options?: { role?: string | null; tenantScoped?: boolean; search?: string; activeTenantSlug?: string | null }
): string {
  const baseHref = panelHref(panel)
  if (!options?.tenantScoped && !TENANT_CONTEXT_PANELS.has(panel)) {
    return baseHref
  }

  const params = new URLSearchParams(options?.search || '')
  const tenant = resolveCustomerTenantId(params, options?.activeTenantSlug)
  const role = options?.role ?? params.get('role')
  const nextParams = new URLSearchParams()
  if (tenant) nextParams.set('tenant', tenant)
  if (role) nextParams.set('role', role)
  const query = nextParams.toString()
  return query ? `${baseHref}?${query}` : baseHref
}

const TENANT_CONTEXT_PANELS = new Set([
  'onboarding/customer',
  'onboarding/customer/analyze',
  'onboarding/customer/confirm',
  'onboarding/customer/deploy',
  'onboarding/customer/soul',
  'onboarding/customer/skills',
  'onboarding/hermes/blueprint',
  'onboarding/hermes/approval',
  'onboarding/hermes/deploy',
  'onboarding/hermes/skills',
  'onboarding/hermes/governance-config',
  'onboarding/hermes/governance-verify',
  'onboarding/hermes/gate-tests',
  'onboarding/hermes/guardian',
  'onboarding/hermes/rts',
  'onboarding/hermes/delivery',
  'boundary',
  'skills',
  'tests',
  'logs',
  'vault',
  'memory',
  'hermes',
  'monitor',
  'harness',
  'alerts',
  'cost-tracker',
  'exec-approvals',
  'activity',
  'channels',
  'cron',
  'tasks',
  'delivery',
])

const PREFETCHED_ROUTES = new Set<string>()
const DEFAULT_PREFETCH_PANELS = [
  'overview',
  'onboarding/overview',
  'onboarding/platform-ready',
  'onboarding/base-selection',
  'onboarding/customer',
  'onboarding/customer/analyze',
  'onboarding/customer/confirm',
  'onboarding/customer/deploy',
  'onboarding/customer/soul',
  'onboarding/customer/skills',
  'onboarding/hermes/blueprint',
  'onboarding/hermes/approval',
  'onboarding/hermes/deploy',
  'onboarding/hermes/skills',
  'onboarding/hermes/governance-config',
  'onboarding/hermes/governance-verify',
  'onboarding/hermes/gate-tests',
  'onboarding/hermes/guardian',
  'onboarding/hermes/rts',
  'onboarding/hermes/delivery',
  'onboarding/gate-testing',
  'onboarding/pre-launch',
  'onboarding/delivery',
  'chat',
  'tasks',
  'agents',
  'activity',
  'notifications',
  'tokens',
]

function safePrefetch(router: ReturnType<typeof useRouter>, href: string) {
  if (PREFETCHED_ROUTES.has(href)) return
  PREFETCHED_ROUTES.add(href)
  router.prefetch(href)
}

export function useNavigateToPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const { activeTenant, setActiveTab, setChatPanelOpen } = useMissionControl()

  useEffect(() => {
    for (const panel of DEFAULT_PREFETCH_PANELS) {
      const href = panelHref(panel)
      if (href !== pathname) safePrefetch(router, href)
    }
  }, [pathname, router])

  return useCallback((panel: string, options?: { role?: string; tenantScoped?: boolean }) => {
    const href = buildPanelNavigationHref(panel, {
      ...options,
      search: typeof window !== 'undefined' ? window.location.search : '',
      activeTenantSlug: activeTenant?.slug,
    })
    if (href === pathname) return
    safePrefetch(router, href)
    startNavigationTiming(pathname, href)
    const isStandaloneRoute = panel.includes('/')
    if (!isStandaloneRoute) {
      setActiveTab(panel === 'sessions' ? 'chat' : panel)
      if (panel === 'chat' || panel === 'sessions') {
        setChatPanelOpen(false)
      }
    }
    startTransition(() => {
      router.push(href, { scroll: false })
    })
  }, [activeTenant?.slug, pathname, router, setActiveTab, setChatPanelOpen])
}

export function usePrefetchPanel() {
  const router = useRouter()
  return useCallback((panel: string) => {
    const href = panelHref(panel)
    safePrefetch(router, href)
  }, [router])
}
