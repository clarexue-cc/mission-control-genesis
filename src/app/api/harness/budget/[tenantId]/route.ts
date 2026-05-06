import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  normalizeConsoleTenantId,
  proxyHarnessConsoleJson,
  readJsonObject,
  routeParams,
  sanitizeBudgetPayload,
} from '@/lib/harness-console-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type BudgetRouteContext = {
  params: { tenantId: string } | Promise<{ tenantId: string }>
}

export async function GET(request: NextRequest, context: BudgetRouteContext) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { tenantId: rawTenantId } = await routeParams(context.params)
    const tenantId = normalizeConsoleTenantId(rawTenantId)
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
    const tenantId = normalizeConsoleTenantId(rawTenantId)
    const raw = await readJsonObject(request)
    const body = sanitizeBudgetPayload(raw)
    return await proxyHarnessConsoleJson({
      method: 'POST',
      path: `/budget/${encodeURIComponent(tenantId)}`,
      body,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
