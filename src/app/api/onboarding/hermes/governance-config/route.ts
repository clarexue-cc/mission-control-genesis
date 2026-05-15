import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { normalizeHermesTenantId, readTenantFile } from '@/lib/hermes-api-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_TENANT_ID = 'media-intel-agent'

function authErrorResponse(error: string, status: 401 | 403) {
  return NextResponse.json({ error }, { status })
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return authErrorResponse(auth.error || 'Authentication required', auth.status || 401)

  const tenantId = normalizeHermesTenantId(
    request.nextUrl.searchParams.get('tenant_id') || request.nextUrl.searchParams.get('tenant') || DEFAULT_TENANT_ID,
  )

  try {
    const [boundaryRules, cronSchedule, approvedSkills] = await Promise.all([
      readTenantFile(tenantId, 'config/boundary-rules.json'),
      readTenantFile(tenantId, 'profile/cron-schedule.yaml'),
      readTenantFile(tenantId, 'profile/approved-skills.json'),
    ])

    return NextResponse.json({
      ok: true,
      tenant_id: tenantId,
      files: {
        boundary_rules: {
          title: 'boundary-rules.json',
          relative_path: 'config/boundary-rules.json',
          ...boundaryRules,
        },
        cron_schedule: {
          title: 'cron-schedule.yaml',
          relative_path: 'profile/cron-schedule.yaml',
          ...cronSchedule,
        },
        approved_skills: {
          title: 'approved-skills.json',
          relative_path: 'profile/approved-skills.json',
          ...approvedSkills,
        },
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to load Hermes governance config', 500)
  }
}
