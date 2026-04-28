import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getUatTask, listUatSubmissions } from '@/lib/uat-tasks'

function authError(error: string, status: 401 | 403) {
  return NextResponse.json({ error }, { status })
}

function errorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return authError(auth.error || 'Authentication required', auth.status || 401)

  const { id } = await params
  const tenantId = request.nextUrl.searchParams.get('tenant_id') || request.nextUrl.searchParams.get('tenant') || 'tenant-tg-001'

  try {
    const task = await getUatTask(tenantId, id)
    if (!task) return errorResponse('UAT task not found', 404)

    const submissions = await listUatSubmissions(tenantId, id)
    return NextResponse.json({ ok: true, tenant_id: tenantId, task, submissions })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to load UAT submissions', 400)
  }
}
