import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { isCustomerRole } from '@/lib/rbac'
import {
  normalizeConsoleTenantId,
  normalizeProviderName,
  proxyHarnessConsoleJson,
  routeParams,
} from '@/lib/harness-console-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ProviderRouteContext = {
  params: { name: string } | Promise<{ name: string }>
}

function resolveSessionTenantSlug(sessionTenantId: number): string | null {
  try {
    const row = getDatabase()
      .prepare('SELECT slug FROM tenants WHERE id = ? LIMIT 1')
      .get(sessionTenantId) as { slug?: unknown } | undefined
    return normalizeConsoleTenantId(row?.slug, 'tenantId')
  } catch {
    return null
  }
}

function canAccessRequestedTenant(role: string, sessionTenantId: number, requestedTenantId: string): boolean {
  if (!isCustomerRole(role)) return true
  const allowedTenantIds = new Set<string>([normalizeConsoleTenantId(String(sessionTenantId), 'tenantId')])
  const sessionTenantSlug = resolveSessionTenantSlug(sessionTenantId)
  if (sessionTenantSlug) allowedTenantIds.add(sessionTenantSlug)
  return allowedTenantIds.has(requestedTenantId)
}

export async function DELETE(request: NextRequest, context: ProviderRouteContext) {
  const auth = requireRole(request, 'customer-admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { name: rawName } = await routeParams(context.params)
    const name = normalizeProviderName(rawName)
    const body = await request.json().catch(() => ({}))
    const tenantId = normalizeConsoleTenantId(
      typeof body?.tenantId === 'string' ? body.tenantId : request.nextUrl.searchParams.get('tenantId'),
    )
    if (!canAccessRequestedTenant(auth.user.role, auth.user.tenant_id, tenantId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    const search = new URLSearchParams({ tenantId })
    return await proxyHarnessConsoleJson({
      method: 'DELETE',
      path: `/providers/${encodeURIComponent(name)}`,
      search,
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to remove provider' }, { status: 400 })
  }
}
