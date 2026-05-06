import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  normalizeConsoleTenantId,
  normalizeProviderName,
  proxyHarnessConsoleJson,
  readJsonObject,
  sanitizeProviderPayload,
} from '@/lib/harness-console-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const tenantId = normalizeConsoleTenantId(request.nextUrl.searchParams.get('tenantId'))
    const search = new URLSearchParams({ tenantId })
    return await proxyHarnessConsoleJson({
      method: 'GET',
      path: '/providers',
      search,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const raw = await readJsonObject(request)
    normalizeConsoleTenantId(raw.tenantId)
    normalizeProviderName(raw.name)
    const body = sanitizeProviderPayload(raw)
    return await proxyHarnessConsoleJson({
      method: 'POST',
      path: '/providers',
      body,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
