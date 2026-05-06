import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

describe('Harness console proxy routes', () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  function user(role: 'admin' | 'operator' | 'viewer') {
    return {
      id: 1,
      username: role,
      display_name: role,
      role,
      workspace_id: 1,
      tenant_id: 1,
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
    authMock.requireRole.mockReturnValue({ user: user('admin') })
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

  it('proxies tenant budget reads to the harness console API', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      monthly_budget_usd: 50,
      alert_at_percent: 80,
      action_on_exceed: 'pause',
    }))
    const { GET } = await import('@/app/api/harness/budget/[tenantId]/route')

    const response = await GET(request('http://localhost/api/harness/budget/tenant-luo-001'), {
      params: Promise.resolve({ tenantId: 'tenant-luo-001' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'admin')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/budget/tenant-luo-001',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(body.monthly_budget_usd).toBe(50)
  })

  it('rejects invalid tenant IDs before proxying budget writes', async () => {
    const { POST } = await import('@/app/api/harness/budget/[tenantId]/route')

    const response = await POST(request('http://localhost/api/harness/budget/../tenant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ monthly_budget_usd: 25 }),
    }), {
      params: Promise.resolve({ tenantId: '../tenant' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('tenantId')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies tenant budget writes without changing the payload', async () => {
    const payload = {
      monthly_budget_usd: 75,
      alert_at_percent: 85,
      action_on_exceed: 'warn',
    }
    fetchMock.mockResolvedValue(jsonResponse({ ...payload, saved: true }))
    const { POST } = await import('@/app/api/harness/budget/[tenantId]/route')

    const response = await POST(request('http://localhost/api/harness/budget/tenant-luo-001', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }), {
      params: Promise.resolve({ tenantId: 'tenant-luo-001' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/budget/tenant-luo-001',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    )
    expect(body.saved).toBe(true)
  })

  it('proxies provider listing with tenant scope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      providers: [{ name: 'openai', baseUrl: 'https://api.openai.com/v1', keyLast4: 'abcd' }],
    }))
    const { GET } = await import('@/app/api/harness/providers/route')

    const response = await GET(request('http://localhost/api/harness/providers?tenantId=tenant-luo-001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/providers?tenantId=tenant-luo-001',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(body.providers[0].keyLast4).toBe('abcd')
  })

  it('proxies provider saves and preserves tenantId in the body', async () => {
    const payload = {
      tenantId: 'tenant-luo-001',
      name: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'sk-test',
    }
    fetchMock.mockResolvedValue(jsonResponse({ saved: true, provider: { name: 'moonshot', keyLast4: 'test' } }))
    const { POST } = await import('@/app/api/harness/providers/route')

    const response = await POST(request('http://localhost/api/harness/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/providers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    )
    expect(body.saved).toBe(true)
  })

  it('proxies provider connection tests by provider name', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, latency_ms: 123 }))
    const { POST } = await import('@/app/api/harness/providers/[name]/test/route')

    const response = await POST(request('http://localhost/api/harness/providers/openai/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'tenant-luo-001' }),
    }), {
      params: Promise.resolve({ name: 'openai' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/providers/openai/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tenantId: 'tenant-luo-001' }),
      }),
    )
    expect(body.ok).toBe(true)
  })

  it('proxies tenant billing reads with month filters', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      tenant: 'tenant-luo-001',
      month: '2026-05',
      totals: { totalTokens: 1000, estimatedCostUsd: 1.25 },
      byAgent: [{ key: 'Agent-Main', totalTokens: 1000, estimatedCostUsd: 1.25 }],
    }))
    const { GET } = await import('@/app/api/harness/billing/[tenantId]/route')

    const response = await GET(request('http://localhost/api/harness/billing/tenant-luo-001?month=2026-05'), {
      params: Promise.resolve({ tenantId: 'tenant-luo-001' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/billing/tenant-luo-001?month=2026-05',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(body.byAgent[0].key).toBe('Agent-Main')
  })
})
