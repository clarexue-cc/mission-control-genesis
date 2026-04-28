import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { generateCustomerSkillFiles } from '@/lib/customer-skill-files'
import { normalizeCustomerTenantId } from '@/lib/customer-intake'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authErrorResponse(error: string, status: 401 | 403) {
  return NextResponse.json({ error }, { status })
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function parseTenantId(value: unknown): string {
  return normalizeCustomerTenantId(typeof value === 'string' ? value : '')
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return authErrorResponse(auth.error || 'Authentication required', auth.status || 401)

  let body: any
  try {
    body = await request.json()
  } catch {
    return errorResponse('Expected JSON body')
  }

  let tenantId: string
  try {
    tenantId = parseTenantId(body?.tenant_id || body?.tenant)
  } catch (error: any) {
    return errorResponse(error?.message || 'Invalid tenant_id')
  }

  try {
    const result = await generateCustomerSkillFiles(tenantId)
    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    const message = error?.message || 'Failed to generate customer Skill files'
    const status = message.includes('different intake-raw.md hash') ? 409 : 400
    return errorResponse(message, status)
  }
}
