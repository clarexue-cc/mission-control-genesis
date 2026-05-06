import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  normalizeConsoleTenantId,
  normalizeProviderName,
  proxyHarnessConsoleJson,
  readJsonObject,
  routeParams,
} from '@/lib/harness-console-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ProviderTestRouteContext = {
  params: { name: string } | Promise<{ name: string }>
}

export async function POST(request: NextRequest, context: ProviderTestRouteContext) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { name: rawName } = await routeParams(context.params)
    const name = normalizeProviderName(rawName)
    const body = await readJsonObject(request)
    if (body.tenantId !== undefined) normalizeConsoleTenantId(body.tenantId)
    return await proxyHarnessConsoleJson({
      method: 'POST',
      path: `/providers/${encodeURIComponent(name)}/test`,
      body,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
