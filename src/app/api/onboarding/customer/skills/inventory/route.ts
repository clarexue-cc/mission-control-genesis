import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { listTenantSkillInventory } from '@/lib/customer-skill-inventory'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const result = await listTenantSkillInventory()
    return NextResponse.json({ ok: true, ...result }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load tenant Skill inventory' }, { status: 500 })
  }
}
