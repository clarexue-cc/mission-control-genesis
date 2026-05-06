import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  canAccessTenant,
  fetchLangfuseJson,
  mapTraceDetail,
  traceTenantId,
} from '@/lib/langfuse-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type TraceRouteContext = {
  params: { traceId: string } | Promise<{ traceId: string }>
}

export async function GET(request: NextRequest, context: TraceRouteContext) {
  const auth = requireRole(request, 'customer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { traceId } = await Promise.resolve(context.params)
    const result = await fetchLangfuseJson(`/api/public/traces/${encodeURIComponent(traceId)}`)
    if (!result.ok) {
      return NextResponse.json({ error: 'Failed to load Langfuse trace' }, { status: result.status })
    }

    const tenantId = traceTenantId(result.payload)
    if (auth.user.role === 'customer' && (!tenantId || !canAccessTenant(auth.user, tenantId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json(mapTraceDetail(result.payload, auth.user.role), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load Langfuse trace' }, { status: 400 })
  }
}
