import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { resolveEffectiveRole } from '@/lib/rbac'
import { getDatabase } from '@/lib/db'
import { createUatTask, listCustomerUatTasks } from '@/lib/uat-tasks'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

function authError(error: string, status: 401 | 403) {
  return NextResponse.json({ error }, { status })
}

function errorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

function effectiveRoleFor(request: NextRequest) {
  return resolveEffectiveRole({
    queryRole: request.nextUrl.searchParams.get('role'),
    cookieString: request.headers.get('cookie'),
  })
}

function tenantFromAuth(auth: { user: { tenant_id?: number | null } }): string | null {
  const tenantId = auth.user.tenant_id
  if (!tenantId) return null
  try {
    const row = getDatabase()
      .prepare('SELECT slug FROM tenants WHERE id = ? LIMIT 1')
      .get(tenantId) as { slug?: string } | undefined
    return row?.slug || null
  } catch {
    return null
  }
}

function resolveTenantParam(request: NextRequest, auth: { user: { tenant_id?: number | null } }): string {
  return request.nextUrl.searchParams.get('tenant_id')
    || request.nextUrl.searchParams.get('tenant')
    || tenantFromAuth(auth)
    || resolveDefaultCustomerTenantId()
}

export async function GET(request: NextRequest) {
  const effectiveRole = effectiveRoleFor(request)
  const auth = requireRole(request, effectiveRole === 'customer' ? 'viewer' : 'admin')
  if ('error' in auth) return authError(auth.error || 'Authentication required', auth.status || 401)

  try {
    const tenantId = resolveTenantParam(request, auth)
    const tasks = await listCustomerUatTasks(tenantId)
    return NextResponse.json({ ok: true, tenant_id: tenantId, tasks })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to load UAT tasks', 400)
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return authError(auth.error || 'Authentication required', auth.status || 401)

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: any
  try {
    body = await request.json()
  } catch {
    return errorResponse('Expected JSON body')
  }

  try {
    const task = await createUatTask({
      tenant_id: body?.tenant_id || body?.tenant,
      title: body?.title,
      description: body?.description,
      created_by: auth.user.username || 'admin',
    })
    return NextResponse.json({ ok: true, task })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to create UAT task', 400)
  }
}
