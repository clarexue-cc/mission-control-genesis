export type EffectiveRole = 'admin' | 'customer-admin' | 'customer-user'
export type LegacyEffectiveRole = 'customer'

export const RBAC_ROLE_COOKIE = 'mc-view-role'
export const CUSTOMER_ADMIN_PANELS = [
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

export const CUSTOMER_USER_PANELS = [
  'overview',
  'agents',
  'tasks',
  'channels',
  'alerts',
  'skills',
] as const

export const PANEL_ACCESS_BY_ROLE = {
  admin: ['*'],
  'customer-admin': CUSTOMER_ADMIN_PANELS,
  'customer-user': CUSTOMER_USER_PANELS,
} as const

export const CUSTOMER_VISIBLE_PANELS = CUSTOMER_ADMIN_PANELS
export type CustomerVisiblePanel = typeof CUSTOMER_VISIBLE_PANELS[number]

const PANEL_ACCESS_SETS: Record<Exclude<EffectiveRole, 'admin'>, Set<string>> = {
  'customer-admin': new Set<string>(CUSTOMER_ADMIN_PANELS),
  'customer-user': new Set<string>(CUSTOMER_USER_PANELS),
}

const QUERY_ROLE_VALUES = new Set(['admin', 'customer-admin', 'customer-user', 'customer'])

export function normalizeEffectiveRole(value: unknown): EffectiveRole {
  if (value === 'customer-user') return 'customer-user'
  if (value === 'customer-admin' || value === 'customer') return 'customer-admin'
  return 'admin'
}

export function isCustomerRole(role: EffectiveRole | LegacyEffectiveRole | string): boolean {
  return normalizeEffectiveRole(role) !== 'admin'
}

export function isCustomerUserRole(role: EffectiveRole | LegacyEffectiveRole | string): boolean {
  return normalizeEffectiveRole(role) === 'customer-user'
}

export function isCustomerAdminRole(role: EffectiveRole | LegacyEffectiveRole | string): boolean {
  return normalizeEffectiveRole(role) === 'customer-admin'
}

export function canAccessPanel(role: EffectiveRole | LegacyEffectiveRole, panel: string): boolean {
  const effectiveRole = normalizeEffectiveRole(role)
  if (effectiveRole === 'admin') return true
  return PANEL_ACCESS_SETS[effectiveRole].has(panel)
}

export function normalizePanelForPath(pathname: string): string {
  const clean = pathname.split('?')[0]?.replace(/^\/+/, '') || ''
  if (!clean) return 'overview'
  return clean.split('/')[0] || 'overview'
}

export function readRoleFromCookieString(cookieString: string | null | undefined): EffectiveRole {
  if (!cookieString) return 'admin'
  const pairs = cookieString.split(';').map(part => part.trim())
  const pair = pairs.find(part => part.startsWith(`${RBAC_ROLE_COOKIE}=`))
  if (!pair) return 'admin'
  return normalizeEffectiveRole(decodeURIComponent(pair.slice(RBAC_ROLE_COOKIE.length + 1)))
}

export function resolveEffectiveRole(input: {
  queryRole?: string | null
  cookieString?: string | null
}): EffectiveRole {
  if (input.queryRole && QUERY_ROLE_VALUES.has(input.queryRole)) {
    return normalizeEffectiveRole(input.queryRole)
  }
  return readRoleFromCookieString(input.cookieString)
}

export function writeRoleCookie(role: EffectiveRole): void {
  if (typeof document === 'undefined') return
  document.cookie = `${RBAC_ROLE_COOKIE}=${encodeURIComponent(role)}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`
}

export function readEffectiveRoleFromBrowser(search = typeof window !== 'undefined' ? window.location.search : ''): EffectiveRole {
  if (typeof window === 'undefined') return 'admin'
  const params = new URLSearchParams(search)
  const queryRole = params.get('role')
  const role = resolveEffectiveRole({ queryRole, cookieString: document.cookie })
  if (queryRole && QUERY_ROLE_VALUES.has(queryRole)) writeRoleCookie(role)
  return role
}
