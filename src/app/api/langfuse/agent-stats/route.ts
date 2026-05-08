import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { normalizeConsoleTenantId } from '@/lib/harness-console-proxy'
import {
  aggregateAgentStats,
  buildLangfuseTraceSearch,
  canAccessTenant,
  fetchLangfuseJson,
  unwrapLangfuseTraceList,
} from '@/lib/langfuse-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'customer-user')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const tenantId = normalizeConsoleTenantId(request.nextUrl.searchParams.get('tenantId'))
    if (!canAccessTenant(auth.user, tenantId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const fromTimestamp = new Date(Date.now() - SEVEN_DAYS_MS)
    const result = await fetchLangfuseJson(
      '/api/public/traces',
      buildLangfuseTraceSearch(tenantId, 100, fromTimestamp),
    )
    if (!result.ok) {
      return NextResponse.json({ error: 'Failed to load Langfuse agent stats' }, { status: result.status })
    }

    return NextResponse.json(aggregateAgentStats(unwrapLangfuseTraceList(result.payload)), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load Langfuse agent stats' }, { status: 400 })
  }
}
