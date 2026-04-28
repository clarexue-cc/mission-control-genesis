import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { resolveEffectiveRole } from '@/lib/rbac'
import { submitUatTask } from '@/lib/uat-tasks'

function authError(error: string, status: 401 | 403) {
  return NextResponse.json({ error }, { status })
}

function errorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return authError(auth.error || 'Authentication required', auth.status || 401)

  const effectiveRole = resolveEffectiveRole({
    queryRole: request.nextUrl.searchParams.get('role'),
    cookieString: request.headers.get('cookie'),
  })
  if (effectiveRole !== 'customer') {
    return authError('Requires customer view role', 403)
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const { id } = await params
  let body: any
  try {
    body = await request.json()
  } catch {
    return errorResponse('Expected JSON body')
  }

  try {
    const submission = await submitUatTask({
      tenant_id: body?.tenant_id || body?.tenant || request.nextUrl.searchParams.get('tenant_id'),
      task_id: id,
      submitted_by: auth.user.username || 'customer',
      response_text: body?.response_text,
      feedback_options: body?.feedback_options,
      feedback_notes: body?.feedback_notes,
      rating: body?.rating,
    })
    return NextResponse.json({ ok: true, submission })
  } catch (error: any) {
    const message = error?.message || 'Failed to submit UAT feedback'
    return errorResponse(message, message.includes('not found') ? 404 : 400)
  }
}
