import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
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

export async function DELETE(request: NextRequest, context: ProviderRouteContext) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { name: rawName } = await routeParams(context.params)
    const name = normalizeProviderName(rawName)
    const body = await request.json().catch(() => ({}))
    const tenantId = normalizeConsoleTenantId(
      typeof body?.tenantId === 'string' ? body.tenantId : request.nextUrl.searchParams.get('tenantId'),
    )
    const search = new URLSearchParams({ tenantId })
    return await proxyHarnessConsoleJson({
      method: 'DELETE',
      path: `/providers/${encodeURIComponent(name)}`,
      search,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
