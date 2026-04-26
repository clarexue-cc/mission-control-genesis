import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getReadyToShipReport } from '@/lib/harness-ready-to-ship'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const report = await getReadyToShipReport({
      tenant: request.nextUrl.searchParams.get('tenant'),
      profile: request.nextUrl.searchParams.get('profile'),
    })
    return NextResponse.json(report, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run ready-to-ship checks' },
      { status: 500 },
    )
  }
}
