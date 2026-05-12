export type InterfaceMode = 'essential' | 'full'

type StableModeEnv = Partial<Pick<NodeJS.ProcessEnv,
  'NODE_ENV'
  | 'MC_DEFAULT_TENANT'
  | 'MC_NAV_FIXED'
  | 'NEXT_PUBLIC_MC_NAV_FIXED'
  | 'NEXT_PUBLIC_MC_DEFAULT_TENANT'
  | 'MC_PREVIEW_MODE'
  | 'MC_STABLE_FIXED'
  | 'NEXT_PUBLIC_MC_STABLE_FIXED'
>>

export const FIXED_DEV_DEFAULT_TENANT_ID = 'wechat-mp-agent'
export const LEGACY_DEFAULT_CUSTOMER_TENANT_ID = 'media-intel-v1'

const clientStableEnv: StableModeEnv = {
  NODE_ENV: process.env.NODE_ENV,
  MC_DEFAULT_TENANT: process.env.MC_DEFAULT_TENANT,
  MC_NAV_FIXED: process.env.MC_NAV_FIXED,
  NEXT_PUBLIC_MC_NAV_FIXED: process.env.NEXT_PUBLIC_MC_NAV_FIXED,
  NEXT_PUBLIC_MC_DEFAULT_TENANT: process.env.NEXT_PUBLIC_MC_DEFAULT_TENANT,
  MC_PREVIEW_MODE: process.env.MC_PREVIEW_MODE,
  MC_STABLE_FIXED: process.env.MC_STABLE_FIXED,
  NEXT_PUBLIC_MC_STABLE_FIXED: process.env.NEXT_PUBLIC_MC_STABLE_FIXED,
}

function withClientStableEnv(env: StableModeEnv): StableModeEnv {
  return {
    NODE_ENV: env.NODE_ENV ?? clientStableEnv.NODE_ENV,
    MC_DEFAULT_TENANT: env.MC_DEFAULT_TENANT ?? clientStableEnv.MC_DEFAULT_TENANT,
    MC_NAV_FIXED: env.MC_NAV_FIXED ?? clientStableEnv.MC_NAV_FIXED,
    NEXT_PUBLIC_MC_NAV_FIXED: env.NEXT_PUBLIC_MC_NAV_FIXED ?? clientStableEnv.NEXT_PUBLIC_MC_NAV_FIXED,
    NEXT_PUBLIC_MC_DEFAULT_TENANT: env.NEXT_PUBLIC_MC_DEFAULT_TENANT ?? clientStableEnv.NEXT_PUBLIC_MC_DEFAULT_TENANT,
    MC_PREVIEW_MODE: env.MC_PREVIEW_MODE ?? clientStableEnv.MC_PREVIEW_MODE,
    MC_STABLE_FIXED: env.MC_STABLE_FIXED ?? clientStableEnv.MC_STABLE_FIXED,
    NEXT_PUBLIC_MC_STABLE_FIXED: env.NEXT_PUBLIC_MC_STABLE_FIXED ?? clientStableEnv.NEXT_PUBLIC_MC_STABLE_FIXED,
  }
}

function isTruthyFlag(value: string | undefined): boolean {
  const normalized = value?.toLowerCase()
  return normalized === '1' || normalized === 'true'
}

export function isFixedNavigationEnabled(env: StableModeEnv = process.env): boolean {
  const resolvedEnv = withClientStableEnv(env)
  return isFixedDevPreviewMode(resolvedEnv)
    || isTruthyFlag(resolvedEnv.MC_NAV_FIXED)
    || isTruthyFlag(resolvedEnv.NEXT_PUBLIC_MC_NAV_FIXED)
}

export function isFixedDevPreviewMode(env: StableModeEnv = process.env): boolean {
  const resolvedEnv = withClientStableEnv(env)
  return resolvedEnv.NODE_ENV === 'development'
    || isTruthyFlag(resolvedEnv.MC_PREVIEW_MODE)
    || isTruthyFlag(resolvedEnv.MC_STABLE_FIXED)
    || isTruthyFlag(resolvedEnv.NEXT_PUBLIC_MC_STABLE_FIXED)
}

export function resolveEffectiveInterfaceMode(mode: InterfaceMode, env: StableModeEnv = process.env): InterfaceMode {
  return isFixedNavigationEnabled(env) ? 'full' : mode
}

export function isNavigationItemHiddenByInterfaceMode(
  item: { essential?: boolean },
  mode: InterfaceMode,
  env: StableModeEnv = process.env
): boolean {
  return resolveEffectiveInterfaceMode(mode, env) === 'essential' && !item.essential
}

export function shouldShowInterfaceModeSwitcher(isAdmin: boolean, env: StableModeEnv = process.env): boolean {
  return isAdmin && !isFixedNavigationEnabled(env)
}

export function resolveDefaultCustomerTenantId(env: StableModeEnv = process.env): string {
  const resolvedEnv = withClientStableEnv(env)
  const explicit = resolvedEnv.NEXT_PUBLIC_MC_DEFAULT_TENANT || resolvedEnv.MC_DEFAULT_TENANT
  if (explicit?.trim()) return explicit.trim()
  return isFixedDevPreviewMode(resolvedEnv) ? FIXED_DEV_DEFAULT_TENANT_ID : LEGACY_DEFAULT_CUSTOMER_TENANT_ID
}

export function resolveCustomerTenantId(
  searchParams: URLSearchParams,
  activeTenantSlug?: string | null,
  env: StableModeEnv = process.env
): string {
  return searchParams.get('tenant')
    || searchParams.get('tenant_id')
    || activeTenantSlug
    || resolveDefaultCustomerTenantId(env)
}

export function resolveStableActiveTenant<T extends { slug?: string | null }>(input: {
  tenants: T[]
  storedTenant: T | null
  userSelected: boolean
  env?: StableModeEnv
}): T | null {
  const { tenants, storedTenant, userSelected, env = process.env } = input
  const tenantExists = (tenant: T | null) =>
    tenant?.slug ? tenants.find(candidate => candidate.slug === tenant.slug) || null : null

  if (!isFixedDevPreviewMode(env)) {
    return tenantExists(storedTenant)
  }

  if (userSelected) {
    const selected = tenantExists(storedTenant)
    if (selected) return selected
  }

  const defaultSlug = resolveDefaultCustomerTenantId(env)
  return tenants.find(tenant => tenant.slug === defaultSlug) || null
}

export function resolveInitialSidebarExpanded(storedValue: string | null, env: StableModeEnv = process.env): boolean {
  if (isFixedNavigationEnabled(env)) return true
  return storedValue === 'true'
}

export function resolveNextSidebarExpanded(current: boolean, env: StableModeEnv = process.env): boolean {
  if (isFixedNavigationEnabled(env)) return true
  return !current
}
