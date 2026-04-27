export type EffectiveRole = 'admin' | 'customer'

export const RBAC_ROLE_COOKIE = 'mc-view-role'
export const CUSTOMER_VISIBLE_PANELS = ['overview', 'cron', 'alerts', 'channels', 'tasks'] as const

export type CustomerVisiblePanel = typeof CUSTOMER_VISIBLE_PANELS[number]

const CUSTOMER_PANEL_SET = new Set<string>(CUSTOMER_VISIBLE_PANELS)

export function normalizeEffectiveRole(value: unknown): EffectiveRole {
  return value === 'customer' ? 'customer' : 'admin'
}

export function isCustomerRole(role: EffectiveRole): boolean {
  return role === 'customer'
}

export function canAccessPanel(role: EffectiveRole, panel: string): boolean {
  if (role !== 'customer') return true
  return CUSTOMER_PANEL_SET.has(panel)
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
  if (input.queryRole === 'customer' || input.queryRole === 'admin') {
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
  if (queryRole === 'customer' || queryRole === 'admin') writeRoleCookie(role)
  return role
}
