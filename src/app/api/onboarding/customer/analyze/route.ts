import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  analyzeCustomerIntake,
  readCustomerAnalysisState,
} from '@/lib/customer-analysis'
import { normalizeCustomerTenantId } from '@/lib/customer-intake'

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
    tenantId = parseTenantId(request.nextUrl.searchParams.get('tenant_id'))
  } catch (error: any) {
    return errorResponse(error?.message || 'Invalid tenant_id')
  }

  try {
    const state = await readCustomerAnalysisState(tenantId)
    return NextResponse.json({
      ok: true,
      tenant_id: state.tenantId,
      intake_raw_path: state.intakeRawPath,
      intake_raw_exists: state.intakeRawExists,
      intake_raw_hash: state.intakeRawHash,
      intake_raw_preview: state.intakeRawPreview,
      analysis_path: state.analysisPath,
      analysis_exists: state.analysisExists,
      analysis_intake_raw_hash: state.analysisIntakeRawHash,
      analysis_matches_intake: state.analysisMatchesIntake,
      content: state.analysisContent,
      mode: state.mode,
      workflow_steps: state.draft?.workflow_steps || [],
      skill_candidates: state.draft?.skill_candidates || [],
      delivery_mode: state.draft?.delivery_mode || null,
      boundary_draft: state.draft?.boundary_draft || [],
      uat_criteria: state.draft?.uat_criteria || [],
    })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to read OB-S2 state', 500)
  }
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
    tenantId = parseTenantId(body?.tenant_id)
  } catch (error: any) {
    return errorResponse(error?.message || 'Invalid tenant_id')
  }

  try {
    const result = await analyzeCustomerIntake(tenantId)
    return NextResponse.json({
      ok: true,
      tenant_id: result.tenantId,
      path: result.path,
      content: result.content,
      mode: result.mode,
      provider: result.provider,
      already_exists: result.alreadyExists,
      workflow_steps: result.draft.workflow_steps,
      skill_candidates: result.draft.skill_candidates,
      delivery_mode: result.draft.delivery_mode,
      boundary_draft: result.draft.boundary_draft,
      uat_criteria: result.draft.uat_criteria,
    })
  } catch (error: any) {
    const message = error?.message || 'Failed to write intake-analysis.md'
    const status = message.includes('different intake-raw.md hash')
      ? 409
      : message.includes('intake-raw.md')
        ? 400
        : 500
    return errorResponse(message, status)
  }
}
