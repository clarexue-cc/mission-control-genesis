import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { normalizeConsoleTenantId } from '@/lib/harness-console-proxy'
import {
  buildLangfuseTraceSearch,
  canAccessTenant,
  fetchLangfuseJson,
  mapTraceSummary,
  unwrapLangfuseTraceList,
} from '@/lib/langfuse-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function readLimit(request: NextRequest): number {
  const rawLimit = Number(request.nextUrl.searchParams.get('limit') || '20')
  if (!Number.isFinite(rawLimit)) return 20
  return Math.max(1, Math.min(100, Math.trunc(rawLimit)))
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'customer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const tenantId = normalizeConsoleTenantId(request.nextUrl.searchParams.get('tenantId'))
    if (!canAccessTenant(auth.user, tenantId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const result = await fetchLangfuseJson(
      '/api/public/traces',
      buildLangfuseTraceSearch(tenantId, readLimit(request)),
    )
    if (!result.ok) {
      return NextResponse.json({ error: 'Failed to load Langfuse traces' }, { status: result.status })
    }

    return NextResponse.json(unwrapLangfuseTraceList(result.payload).map(mapTraceSummary), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load Langfuse traces' }, { status: 400 })
  }
}
