import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { isCustomerRole, readRoleFromCookieString } from '@/lib/rbac'
import {
  enforceBudgetCeiling,
  normalizeConsoleTenantId,
  proxyHarnessConsoleJson,
  readJsonObject,
  resolveHarnessConsoleBaseUrl,
  routeParams,
  sanitizeBudgetPayload,
} from '@/lib/harness-console-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type BudgetRouteContext = {
  params: { tenantId: string } | Promise<{ tenantId: string }>
}

function resolveScopedTenantId(request: NextRequest, requestedTenantId: string, sessionTenantId: number): string {
  if (!isCustomerRole(readRoleFromCookieString(request.headers.get('cookie')))) {
    return requestedTenantId
  }

  const row = getDatabase()
    .prepare('SELECT slug FROM tenants WHERE id = ? LIMIT 1')
    .get(sessionTenantId) as { slug?: unknown } | undefined
  return normalizeConsoleTenantId(row?.slug, 'tenantId')
}

function parseAdminBudgetCeiling(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }
  return null
}

async function readAdminBudgetCeiling(tenantId: string): Promise<{ ceiling: number } | { error: string }> {
  let upstream: Response
  try {
    upstream = await fetch(
      `${resolveHarnessConsoleBaseUrl()}/api/console/budget/${encodeURIComponent(tenantId)}`,
      {
        method: 'GET',
        cache: 'no-store',
      },
    )
  } catch {
    return { error: 'Failed to load admin budget ceiling' }
  }
  const payload = await upstream.clone().json().catch(() => undefined) as { error?: unknown; max_budget_usd?: unknown } | undefined

  if (!upstream.ok) {
    return {
      error: typeof payload?.error === 'string' ? payload.error : 'Failed to load admin budget ceiling',
    }
  }
  if (!payload || typeof payload !== 'object' || !('max_budget_usd' in payload)) {
    return { error: 'Invalid admin budget ceiling response' }
  }

  const ceiling = parseAdminBudgetCeiling(payload.max_budget_usd)
  if (ceiling === null) {
    return { error: 'Invalid admin budget ceiling' }
  }
  return { ceiling }
}

export async function GET(request: NextRequest, context: BudgetRouteContext) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { tenantId: rawTenantId } = await routeParams(context.params)
    const tenantId = resolveScopedTenantId(request, normalizeConsoleTenantId(rawTenantId), auth.user.tenant_id)
    return await proxyHarnessConsoleJson({
      method: 'GET',
      path: `/budget/${encodeURIComponent(tenantId)}`,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}

export async function POST(request: NextRequest, context: BudgetRouteContext) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { tenantId: rawTenantId } = await routeParams(context.params)
    const tenantId = resolveScopedTenantId(request, normalizeConsoleTenantId(rawTenantId), auth.user.tenant_id)
    const raw = await readJsonObject(request)
    const sanitized = sanitizeBudgetPayload(raw)
    const ceilingResult = await readAdminBudgetCeiling(tenantId)
    if ('error' in ceilingResult) {
      return NextResponse.json({ error: ceilingResult.error }, { status: 502 })
    }
    const body = enforceBudgetCeiling(sanitized, ceilingResult.ceiling)
    return await proxyHarnessConsoleJson({
      method: 'POST',
      path: `/budget/${encodeURIComponent(tenantId)}`,
      body,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
