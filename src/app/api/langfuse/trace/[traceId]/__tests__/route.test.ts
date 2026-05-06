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

describe('GET /api/langfuse/trace/[traceId]', () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  function user(role: 'admin' | 'customer', tenantId = 7) {
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

  function request(url: string) {
    return new NextRequest(url)
  }

  beforeEach(() => {
    vi.resetModules()
    authMock.requireRole.mockReset()
    authMock.requireRole.mockReturnValue({ user: user('customer') })
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
      LANGFUSE_BASE_URL: 'http://langfuse.local',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('returns a customer-owned trace with truncated input and output', async () => {
    const longInput = 'i'.repeat(250)
    const longOutput = 'o'.repeat(250)
    fetchMock.mockResolvedValue(jsonResponse({
      id: 'trace-1',
      timestamp: '2026-05-06T12:00:00.000Z',
      metadata: { tenant: 'tenant-owned-007', agent: 'researcher', skill: 'search' },
      input: longInput,
      output: longOutput,
      latency: 1.5,
      totalCost: 0.04,
      observations: [
        { model: 'gpt-5.4', usageDetails: { input: 10, output: 20, total: 30 } },
      ],
    }))
    const { GET } = await import('@/app/api/langfuse/trace/[traceId]/route')

    const response = await GET(request('http://localhost/api/langfuse/trace/trace-1'), {
      params: Promise.resolve({ traceId: 'trace-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'customer')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://langfuse.local/api/public/traces/trace-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`,
        }),
      }),
    )
    expect(body).toEqual({
      traceId: 'trace-1',
      timestamp: '2026-05-06T12:00:00.000Z',
      agent: 'researcher',
      skill: 'search',
      model: 'gpt-5.4',
      input: `${'i'.repeat(200)}...`,
      output: `${'o'.repeat(200)}...`,
      latencyMs: 1500,
      tokens: 30,
      costUsd: 0.04,
      langfuseUrl: 'http://langfuse.local/trace/trace-1',
    })
    expect(JSON.stringify(body)).not.toContain('sk-test')
  })

  it('blocks a customer when the trace belongs to another tenant', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      id: 'trace-2',
      timestamp: '2026-05-06T12:00:00.000Z',
      metadata: { tenant: 'tenant-other-001' },
    }))
    const { GET } = await import('@/app/api/langfuse/trace/[traceId]/route')

    const response = await GET(request('http://localhost/api/langfuse/trace/trace-2'), {
      params: Promise.resolve({ traceId: 'trace-2' }),
    })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Access denied' })
  })

  it('returns complete input and output for admin users', async () => {
    const longInput = 'admin-input-'.repeat(30)
    const longOutput = 'admin-output-'.repeat(30)
    authMock.requireRole.mockReturnValue({ user: user('admin', 1) })
    fetchMock.mockResolvedValue(jsonResponse({
      id: 'trace-3',
      timestamp: '2026-05-06T12:00:00.000Z',
      metadata: { tenant: 'tenant-other-001', agent: 'operator', skill: 'debug', model: 'claude' },
      input: longInput,
      output: longOutput,
      latency: 0.25,
      totalTokens: 44,
      totalCost: 0.005,
    }))
    const { GET } = await import('@/app/api/langfuse/trace/[traceId]/route')

    const response = await GET(request('http://localhost/api/langfuse/trace/trace-3'), {
      params: Promise.resolve({ traceId: 'trace-3' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.input).toBe(longInput)
    expect(body.output).toBe(longOutput)
    expect(body.tokens).toBe(44)
    expect(body.langfuseUrl).toBe('http://langfuse.local/trace/trace-3')
  })
})
