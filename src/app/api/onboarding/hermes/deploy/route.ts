import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { listTenantDir, normalizeHermesTenantId, readTenantFile } from '@/lib/hermes-api-helpers'

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
    const [identityConfig, harnessMeta, hermesConfig, agentIntelFiles, agentSharedFiles] = await Promise.all([
      readTenantFile(tenantId, 'profile/identity/config.yaml'),
      readTenantFile(tenantId, 'config/harness-meta.json'),
      readTenantFile(tenantId, 'config/hermes.json'),
      listTenantDir(tenantId, 'vault/Agent-情报搜集'),
      listTenantDir(tenantId, 'vault/Agent-Shared'),
    ])

    return NextResponse.json({
      ok: true,
      tenant_id: tenantId,
      files: {
        identity_config: {
          title: 'config.yaml',
          relative_path: 'profile/identity/config.yaml',
          ...identityConfig,
        },
        harness_meta: {
          title: 'harness-meta.json',
          relative_path: 'config/harness-meta.json',
          ...harnessMeta,
        },
        hermes: {
          title: 'hermes.json',
          relative_path: 'config/hermes.json',
          ...hermesConfig,
        },
      },
      vault: {
        agent_intel_path: 'vault/Agent-情报搜集',
        agent_intel_files: agentIntelFiles,
        agent_shared_path: 'vault/Agent-Shared',
        agent_shared_files: agentSharedFiles,
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to load Hermes deploy config', 500)
  }
}
