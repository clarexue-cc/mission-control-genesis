import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { normalizeBoundaryTemplateTenant } from '@/lib/harness-boundary'
import { readVaultFile, readVaultTree } from '@/lib/harness-vault'
import { isCustomerRole, readRoleFromCookieString } from '@/lib/rbac'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (isCustomerRole(readRoleFromCookieString(request.headers.get('cookie')))) {
    return NextResponse.json({ error: 'Customer role cannot access vault internals' }, { status: 403 })
  }

  let tenant
  try {
    tenant = normalizeBoundaryTemplateTenant(request.nextUrl.searchParams.get('tenant') || process.env.MC_DEFAULT_TENANT || 'wechat-mp-agent')
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Invalid tenant' }, { status: 400 })
  }

  const action = request.nextUrl.searchParams.get('action') || 'tree'

  try {
    if (action === 'tree') {
      const depth = Number.parseInt(request.nextUrl.searchParams.get('depth') || '6', 10)
      const state = await readVaultTree(tenant, Number.isFinite(depth) ? depth : 6)
      return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } })
    }

    if (action === 'content') {
      const filePath = request.nextUrl.searchParams.get('path')
      if (!filePath) return NextResponse.json({ error: 'path is required' }, { status: 400 })
      const file = await readVaultFile(tenant, filePath)
      return NextResponse.json(file, { headers: { 'Cache-Control': 'no-store' } })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    const message = error?.message || 'Failed to read vault'
    const status = message.includes('not found') ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
