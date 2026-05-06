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

describe('GET /api/langfuse/traces', () => {
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

  it('returns simplified traces for a customer owned tenant', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      data: [
        {
          id: 'trace-1',
          timestamp: '2026-05-06T12:00:00.000Z',
          name: 'chat',
          metadata: {
            tenant: 'tenant-owned-007',
            agent: 'researcher',
            skill: 'search',
            model: 'gpt-5.4',
            status: 'success',
          },
          latency: 1.25,
          totalTokens: 321,
          totalCost: 0.012345,
        },
        {
          id: 'trace-2',
          timestamp: '2026-05-06T12:01:00.000Z',
          metadata: {
            tenant: 'tenant-owned-007',
            agentName: 'writer',
            skillName: 'draft',
          },
          observations: [
            { level: 'ERROR', usageDetails: { total: 100 }, costDetails: { total: 0.02 } },
          ],
          latency: 0.8,
        },
      ],
    }))
    const { GET } = await import('@/app/api/langfuse/traces/route')

    const response = await GET(request('http://localhost/api/langfuse/traces?tenantId=tenant-owned-007&limit=20'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'customer')
    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(upstreamUrl.origin + upstreamUrl.pathname).toBe('http://langfuse.local/api/public/traces')
    expect(upstreamUrl.searchParams.get('metadata.tenant')).toBe('tenant-owned-007')
    expect(upstreamUrl.searchParams.get('limit')).toBe('20')
    expect(upstreamUrl.searchParams.get('orderBy')).toBe('timestamp.desc')
    expect(upstreamUrl.searchParams.get('filter')).toContain('"key":"tenant"')
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        authorization: `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`,
      }),
    }))
    expect(body).toEqual([
      {
        traceId: 'trace-1',
        timestamp: '2026-05-06T12:00:00.000Z',
        agent: 'researcher',
        skill: 'search',
        model: 'gpt-5.4',
        latencyMs: 1250,
        totalTokens: 321,
        costUsd: 0.012345,
        status: 'success',
      },
      {
        traceId: 'trace-2',
        timestamp: '2026-05-06T12:01:00.000Z',
        agent: 'writer',
        skill: 'draft',
        model: null,
        latencyMs: 800,
        totalTokens: 100,
        costUsd: 0.02,
        status: 'error',
      },
    ])
    expect(JSON.stringify(body)).not.toContain('sk-test')
  })

  it('blocks a customer from reading traces for another tenant', async () => {
    const { GET } = await import('@/app/api/langfuse/traces/route')

    const response = await GET(request('http://localhost/api/langfuse/traces?tenantId=tenant-other-001&limit=20'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Access denied' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
