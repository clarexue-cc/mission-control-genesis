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

describe('DELETE /api/harness/providers/[name]', () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  function user(role: 'admin' | 'customer-admin', tenantId = 7) {
    return {
      id: 1,
      username: role,
      display_name: role,
      role,
      workspace_id: 1,
      tenant_id: tenantId,
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
    authMock.requireRole.mockReturnValue({ user: user('customer-admin') })
    dbMock.get.mockReset()
    dbMock.prepare.mockReset()
    dbMock.getDatabase.mockReset()
    dbMock.prepare.mockImplementation(() => ({ get: dbMock.get }))
    dbMock.get.mockImplementation((tenantId: number) => ({
      slug: tenantId === 7 ? 'tenant-owned-007' : 'tenant-default-001',
    }))
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
    authMock.requireRole.mockReset()
    vi.resetModules()
  })

  it('lets a customer delete a provider for their own tenant', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ removed: true }))
    const { DELETE } = await import('@/app/api/harness/providers/[name]/route')

    const response = await DELETE(request('http://localhost/api/harness/providers/openai', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'tenant-owned-007' }),
    }), {
      params: Promise.resolve({ name: 'openai' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'customer-admin')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/providers/openai?tenantId=tenant-owned-007',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(body.removed).toBe(true)
  })

  it('blocks a customer from deleting another tenant provider', async () => {
    const { DELETE } = await import('@/app/api/harness/providers/[name]/route')

    const response = await DELETE(request('http://localhost/api/harness/providers/openai?tenantId=tenant-other-001', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ name: 'openai' }),
    })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Access denied' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lets an admin delete a provider for any tenant', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin', 1) })
    fetchMock.mockResolvedValue(jsonResponse({ removed: true }))
    const { DELETE } = await import('@/app/api/harness/providers/[name]/route')

    const response = await DELETE(request('http://localhost/api/harness/providers/anthropic?tenantId=tenant-other-001', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ name: 'anthropic' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'customer-admin')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/providers/anthropic?tenantId=tenant-other-001',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(body.removed).toBe(true)
  })

  it('masks upstream delete errors without leaking backend paths', async () => {
    fetchMock.mockRejectedValue(new Error('failed at /srv/mc/secrets/providers.json'))
    const { DELETE } = await import('@/app/api/harness/providers/[name]/route')

    const response = await DELETE(request('http://localhost/api/harness/providers/openai', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'tenant-owned-007' }),
    }), {
      params: Promise.resolve({ name: 'openai' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Failed to remove provider' })
    expect(JSON.stringify(body)).not.toContain('/srv/mc/secrets')
  })
})
