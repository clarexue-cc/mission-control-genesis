import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { buildCustomerBlueprintPayload } from '@/lib/customer-blueprint'
import { readCustomerAnalysisState } from '@/lib/customer-analysis'
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

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return authErrorResponse(auth.error || 'Authentication required', auth.status || 401)

  let tenantId: string
  try {
    tenantId = parseTenantId(request.nextUrl.searchParams.get('tenant_id') || request.nextUrl.searchParams.get('tenant'))
  } catch (error: any) {
    return errorResponse(error?.message || 'Invalid tenant_id')
  }

  try {
    const state = await readCustomerAnalysisState(tenantId)
    if (!state.analysisExists) {
      return errorResponse('vault/intake-analysis.md is required before loading the P4 blueprint', 404)
    }
    if (state.analysisMatchesIntake === false) {
      return errorResponse('vault/intake-analysis.md was generated from a different intake-raw.md hash; rerun P4 before loading drafts', 409)
    }
    if (!state.draft) {
      return errorResponse('P4 machine-readable blueprint is required before loading drafts', 404)
    }
    return NextResponse.json({ ok: true, ...buildCustomerBlueprintPayload(state) }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to load P4 blueprint', 500)
  }
}
