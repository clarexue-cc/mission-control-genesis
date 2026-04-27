import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  confirmCustomerOnboarding,
  readCustomerConfirmationState,
} from '@/lib/customer-confirmation'
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
    const state = await readCustomerConfirmationState(tenantId)
    return NextResponse.json({
      ok: true,
      tenant_id: state.tenantId,
      intake_raw_path: state.intakeRawPath,
      intake_raw_exists: state.intakeRawExists,
      intake_raw_hash: state.intakeRawHash,
      intake_raw_preview: state.intakeRawPreview,
      confirmation_path: state.confirmationPath,
      confirmation_exists: state.confirmationExists,
      content: state.confirmationContent,
    })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to read OB-S3 state', 500)
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
    const result = await confirmCustomerOnboarding({
      tenantId,
      signedBy: auth.user.username,
      confirmationText: typeof body?.confirmation_text === 'string' ? body.confirmation_text : '',
    })

    return NextResponse.json({
      ok: true,
      tenant_id: result.tenantId,
      path: result.path,
      content: result.content,
      already_exists: result.alreadyExists,
      intake_raw_hash: result.intakeRawHash,
      message: result.alreadyExists ? 'confirmation-cc.md already exists; not overwritten' : 'confirmation-cc.md generated',
    })
  } catch (error: any) {
    const message = error?.message || 'Failed to write confirmation-cc.md'
    const status = message.includes('intake-raw.md') ? 400 : 500
    return errorResponse(message, status)
  }
}
