import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { isCustomerRole, readRoleFromCookieString } from '@/lib/rbac'
import {
  maskApiKey,
  normalizeConsoleTenantId,
  normalizeProviderName,
  proxyHarnessConsoleJson,
  readJsonObject,
  sanitizeProviderPayload,
} from '@/lib/harness-console-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function resolveScopedTenantId(request: NextRequest, requestedTenantId: string, sessionTenantId: number): string {
  if (!isCustomerRole(readRoleFromCookieString(request.headers.get('cookie')))) {
    return requestedTenantId
  }

  const row = getDatabase()
    .prepare('SELECT slug FROM tenants WHERE id = ? LIMIT 1')
    .get(sessionTenantId) as { slug?: unknown } | undefined
  return normalizeConsoleTenantId(row?.slug, 'tenantId')
}

function maskProviderApiKeys(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map(maskProviderApiKeys)
  }
  if (!payload || typeof payload !== 'object') {
    return payload
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (key === 'apiKey' && typeof value === 'string') {
        return [key, maskApiKey(value)]
      }
      return [key, maskProviderApiKeys(value)]
    }),
  )
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const tenantId = resolveScopedTenantId(
      request,
      normalizeConsoleTenantId(request.nextUrl.searchParams.get('tenantId')),
      auth.user.tenant_id,
    )
    const search = new URLSearchParams({ tenantId })
    const response = await proxyHarnessConsoleJson({
      method: 'GET',
      path: '/providers',
      search,
    })
    if (!isCustomerRole(readRoleFromCookieString(request.headers.get('cookie')))) {
      return response
    }

    const payload = await response.json().catch(() => null)
    return NextResponse.json(maskProviderApiKeys(payload), {
      status: response.status,
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const raw = await readJsonObject(request)
    const tenantId = resolveScopedTenantId(
      request,
      normalizeConsoleTenantId(raw.tenantId),
      auth.user.tenant_id,
    )
    normalizeProviderName(raw.name)
    const body = sanitizeProviderPayload({ ...raw, tenantId })
    return await proxyHarnessConsoleJson({
      method: 'POST',
      path: '/providers',
      body,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
