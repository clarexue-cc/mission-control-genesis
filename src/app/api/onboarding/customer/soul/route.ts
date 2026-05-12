import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  generateCustomerSoul,
  readCustomerSoulState,
  readP7FilesStatus,
} from '@/lib/customer-soul'
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
    const [state, p7Status] = await Promise.all([
      readCustomerSoulState(tenantId),
      readP7FilesStatus(tenantId),
    ])
    return NextResponse.json({
      ok: true,
      tenant_id: state.tenantId,
      analysis_path: state.analysisPath,
      analysis_exists: state.analysisExists,
      analysis_preview: state.analysisPreview,
      paths: {
        soul: state.soulPath,
        agents: state.agentsPath,
      },
      content: {
        soul: state.soulContent,
        agents: state.agentsContent,
      },
      soul_exists: state.soulExists,
      agents_exists: state.agentsExists,
      mode: state.mode,
      unresolved_placeholders: state.unresolvedPlaceholders,
      content_hashes: state.contentHashes,
      p7_files: {
        total: p7Status.total,
        exists_count: p7Status.existsCount,
        missing_count: p7Status.missingCount,
        groups: {
          workspace: p7Status.groups.workspace.map(f => ({
            name: f.name, display_name: f.displayName, relative_path: f.relativePath,
            group: f.group, exists: f.exists, size_bytes: f.sizeBytes,
          })),
          skills: p7Status.groups.skills.map(f => ({
            name: f.name, display_name: f.displayName, relative_path: f.relativePath,
            group: f.group, exists: f.exists, size_bytes: f.sizeBytes,
          })),
          vault: p7Status.groups.vault.map(f => ({
            name: f.name, display_name: f.displayName, relative_path: f.relativePath,
            group: f.group, exists: f.exists, size_bytes: f.sizeBytes,
          })),
        },
      },
    })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to read OB-S5 state', 500)
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
    const result = await generateCustomerSoul(tenantId)
    return NextResponse.json({
      ok: true,
      tenant_id: result.tenantId,
      paths: result.paths,
      content: result.content,
      mode: result.mode,
      provider: result.provider,
      already_exists: result.alreadyExists,
      diff_vs_template: result.diffVsTemplate,
      unresolved_placeholders: result.unresolvedPlaceholders,
      content_hashes: result.contentHashes,
    })
  } catch (error: any) {
    const message = error?.message || 'Failed to write SOUL/AGENTS files'
    const status = message.includes('intake-analysis.md') ? 400 : 500
    return errorResponse(message, status)
  }
}
