import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { normalizeBoundaryTenant, readBoundaryRulesState } from '@/lib/harness-boundary'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let tenant
  try {
    tenant = normalizeBoundaryTenant(request.nextUrl.searchParams.get('tenant') || 'ceo-assistant-v1')
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Invalid tenant' }, { status: 400 })
  }

  try {
    const state = await readBoundaryRulesState(tenant)
    return NextResponse.json(state, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load boundary rules' }, { status: 500 })
  }
}
