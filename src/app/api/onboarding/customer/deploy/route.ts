import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  deployCustomerTenant,
  readCustomerDeployState,
} from '@/lib/customer-deploy'
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
    const state = await readCustomerDeployState(tenantId)
    return NextResponse.json({
      ok: true,
      tenant_id: state.tenantId,
      tenant_root: state.tenantRoot,
      confirmation_path: state.confirmationPath,
      confirmation_exists: state.confirmationExists,
      confirmation_preview: state.confirmationPreview,
      deploy_status_path: state.deployStatusPath,
      deploy_status: state.deployStatus,
      vault_tree: state.vaultTree,
      workspace_tree: state.workspaceTree,
      openclaw_config: state.openclawConfig,
    })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to read OB-S4 state', 500)
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
    const result = await deployCustomerTenant(tenantId)
    return NextResponse.json({
      ok: true,
      tenant_id: result.tenantId,
      tenant_root: result.tenantRoot,
      already_deployed: result.alreadyDeployed,
      container: result.container,
      deploy_status_path: result.deployStatusPath,
      deploy_status: result.deployStatus,
      vault_tree: result.vaultTree,
      workspace_tree: result.workspaceTree,
      openclaw_config: result.openclawConfig,
    })
  } catch (error: any) {
    const message = error?.message || 'Failed to deploy customer tenant'
    const status = message.includes('confirmation-cc.md') ? 400 : 500
    return errorResponse(message, status)
  }
}
