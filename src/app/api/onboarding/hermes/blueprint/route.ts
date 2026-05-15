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

function parseJson(content: string | null) {
  if (!content) return null
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return authErrorResponse(auth.error || 'Authentication required', auth.status || 401)

  const tenantId = normalizeHermesTenantId(
    request.nextUrl.searchParams.get('tenant_id') || request.nextUrl.searchParams.get('tenant') || DEFAULT_TENANT_ID,
  )

  try {
    const [blueprint, profileVars, userProfile] = await Promise.all([
      readTenantFile(tenantId, 'vault/intake-analysis.md'),
      readTenantFile(tenantId, 'profile/profile-vars.json'),
      readTenantFile(tenantId, 'profile/USER.md'),
    ])

    return NextResponse.json({
      ok: true,
      tenant_id: tenantId,
      blueprint: {
        path: 'phase0/tenants/{tenant}/vault/intake-analysis.md',
        relative_path: 'vault/intake-analysis.md',
        ...blueprint,
      },
      profile_vars: {
        path: 'phase0/tenants/{tenant}/profile/profile-vars.json',
        relative_path: 'profile/profile-vars.json',
        json: parseJson(profileVars.content),
        ...profileVars,
      },
      user_profile: {
        path: 'phase0/tenants/{tenant}/profile/USER.md',
        relative_path: 'profile/USER.md',
        ...userProfile,
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to load Hermes blueprint', 500)
  }
}
