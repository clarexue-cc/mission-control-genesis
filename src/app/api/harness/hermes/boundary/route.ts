import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getHermesPanelStatus, runHermesCommand } from '@/lib/hermes-harness'
import { mutationLimiter } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return NextResponse.json(getHermesPanelStatus('boundary'), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    return NextResponse.json(await runHermesCommand('boundary', await request.json()))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Hermes boundary scan failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
