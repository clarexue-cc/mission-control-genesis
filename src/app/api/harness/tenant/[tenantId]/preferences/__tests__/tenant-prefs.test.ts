import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

const dbMock = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  prepare: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbMock.getDatabase,
}))

describe('/api/harness/tenant/[tenantId]/preferences', () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  function customer() {
    return {
      id: 1,
      username: 'customer',
      display_name: 'Customer',
      role: 'customer-admin',
      workspace_id: 1,
      tenant_id: 7,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
    }
  }

  function jsonResponse(body: unknown, init?: ResponseInit) {
    return new Response(JSON.stringify(body), {
      status: init?.status || 200,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers || {}),
      },
    })
  }

  function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
    return new NextRequest(url, init)
  }

  beforeEach(() => {
    vi.resetModules()
    authMock.requireRole.mockReset()
    authMock.requireRole.mockReturnValue({ user: customer() })
    dbMock.get.mockReset()
    dbMock.prepare.mockReset()
    dbMock.getDatabase.mockReset()
    dbMock.prepare.mockImplementation(() => ({ get: dbMock.get }))
    dbMock.get.mockReturnValue({ slug: 'tenant-owned-007' })
    dbMock.getDatabase.mockReturnValue({ prepare: dbMock.prepare })
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    process.env = {
      ...originalEnv,
      MC_HARNESS_CONSOLE_URL: 'http://harness.local:3088',
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('reads only customer preference fields from the tenant config', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      default_model: 'anthropic',
      notifications: {
        email: true,
        budgetAlerts: false,
        deliveryUpdates: true,
      },
      tools: { deny: ['shell'] },
      bindings: { slack: 'internal' },
    }))
    const { GET } = await import('@/app/api/harness/tenant/[tenantId]/preferences/route')

    const response = await GET(request('http://localhost/api/harness/tenant/tenant-owned-007/preferences'), {
      params: Promise.resolve({ tenantId: 'tenant-owned-007' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'customer-admin')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/tenant/tenant-owned-007/config',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
    expect(body).toEqual({
      default_model: 'anthropic',
      notifications: {
        email: true,
        budgetAlerts: false,
        deliveryUpdates: true,
      },
    })
    expect(JSON.stringify(body)).not.toContain('tools')
    expect(JSON.stringify(body)).not.toContain('bindings')
  })

  it('blocks access to a different tenant slug before proxying', async () => {
    const { GET } = await import('@/app/api/harness/tenant/[tenantId]/preferences/route')

    const response = await GET(request('http://localhost/api/harness/tenant/tenant-other/preferences'), {
      params: Promise.resolve({ tenantId: 'tenant-other' }),
    })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('tenant')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unknown or safety-sensitive fields in preference patches', async () => {
    const { PATCH } = await import('@/app/api/harness/tenant/[tenantId]/preferences/route')

    const response = await PATCH(request('http://localhost/api/harness/tenant/tenant-owned-007/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        default_model: 'openai',
        tools: { deny: [] },
        notifications: { email: true },
      }),
    }), {
      params: Promise.resolve({ tenantId: 'tenant-owned-007' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('Invalid tenant preferences')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('merges allowed fields only and never writes safety config keys', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        default_model: 'openai',
        notifications: {
          email: true,
          budgetAlerts: false,
          deliveryUpdates: false,
        },
        tools: { deny: ['shell'] },
        bindings: { slack: 'internal' },
        plugins: { allow: ['safe-plugin'] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        default_model: 'anthropic',
        notifications: {
          email: true,
          budgetAlerts: true,
          deliveryUpdates: false,
        },
      }))
    const { PATCH } = await import('@/app/api/harness/tenant/[tenantId]/preferences/route')

    const response = await PATCH(request('http://localhost/api/harness/tenant/tenant-owned-007/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        default_model: 'anthropic',
        notifications: { budgetAlerts: true },
      }),
    }), {
      params: Promise.resolve({ tenantId: 'tenant-owned-007' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://harness.local:3088/api/console/tenant/tenant-owned-007/config',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://harness.local:3088/api/console/tenant/tenant-owned-007/config',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          default_model: 'anthropic',
          notifications: {
            email: true,
            budgetAlerts: true,
            deliveryUpdates: false,
          },
        }),
      }),
    )
    const writeBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(writeBody.tools).toBeUndefined()
    expect(writeBody.bindings).toBeUndefined()
    expect(writeBody.plugins).toBeUndefined()
    expect(body).toEqual({
      default_model: 'anthropic',
      notifications: {
        email: true,
        budgetAlerts: true,
        deliveryUpdates: false,
      },
    })
  })

  it('does not write preference branches that were not patched', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        default_model: 'openai',
        notifications: {
          email: true,
          budgetAlerts: false,
          deliveryUpdates: false,
        },
        tools: { deny: ['shell'] },
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { PATCH } = await import('@/app/api/harness/tenant/[tenantId]/preferences/route')

    const response = await PATCH(request('http://localhost/api/harness/tenant/tenant-owned-007/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default_model: 'anthropic' }),
    }), {
      params: Promise.resolve({ tenantId: 'tenant-owned-007' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    const writeBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(writeBody).toEqual({ default_model: 'anthropic' })
    expect(writeBody.notifications).toBeUndefined()
    expect(writeBody.tools).toBeUndefined()
    expect(body).toEqual({
      default_model: 'anthropic',
      notifications: {
        email: true,
        budgetAlerts: false,
        deliveryUpdates: false,
      },
    })
  })
})
