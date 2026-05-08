import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  normalizeConsoleTenantId,
  normalizeConsoleMonth,
  proxyHarnessConsoleJson,
  routeParams,
} from '@/lib/harness-console-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type BillingRouteContext = {
  params: { tenantId: string } | Promise<{ tenantId: string }>
}

export async function GET(request: NextRequest, context: BillingRouteContext) {
  const auth = requireRole(request, 'customer-admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { tenantId: rawTenantId } = await routeParams(context.params)
    const tenantId = normalizeConsoleTenantId(rawTenantId)
    const search = new URLSearchParams()
    const month = request.nextUrl.searchParams.get('month')
    if (month) search.set('month', normalizeConsoleMonth(month))
    return await proxyHarnessConsoleJson({
      method: 'GET',
      path: `/billing/${encodeURIComponent(tenantId)}`,
      search,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
