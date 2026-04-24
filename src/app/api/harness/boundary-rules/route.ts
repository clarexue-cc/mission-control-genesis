import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readBoundaryRulesState } from '@/lib/harness-boundary'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const state = await readBoundaryRulesState()
  return NextResponse.json(state, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
