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

describe('GET /api/langfuse/agent-stats', () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  function customer() {
    return {
      id: 1,
      username: 'customer',
      display_name: 'Customer',
      role: 'customer',
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

  function request(url: string) {
    return new NextRequest(url)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'))
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
      LANGFUSE_BASE_URL: 'http://langfuse.local',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('aggregates the last seven days of customer traces by agent', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      data: [
        {
          id: 'trace-1',
          timestamp: '2026-05-06T12:00:00.000Z',
          metadata: { tenant: 'tenant-owned-007', agent: 'researcher', skill: 'search', status: 'success' },
          latency: 1.2,
          totalCost: 0.01,
        },
        {
          id: 'trace-2',
          timestamp: '2026-05-06T12:01:00.000Z',
          metadata: { tenant: 'tenant-owned-007', agent: 'researcher', skill: 'summarize' },
          latency: 0.8,
          totalCost: 0.02,
          errorCount: 1,
        },
        {
          id: 'trace-3',
          timestamp: '2026-05-06T12:02:00.000Z',
          metadata: { tenant: 'tenant-owned-007', agent: 'writer', skill: 'draft', status: 'success' },
          latency: 2,
          totalCost: 0.03,
        },
      ],
    }))
    const { GET } = await import('@/app/api/langfuse/agent-stats/route')

    const response = await GET(request('http://localhost/api/langfuse/agent-stats?tenantId=tenant-owned-007'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'customer')
    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(upstreamUrl.searchParams.get('metadata.tenant')).toBe('tenant-owned-007')
    expect(upstreamUrl.searchParams.get('fromTimestamp')).toBe('2026-04-29T12:00:00.000Z')
    expect(upstreamUrl.searchParams.get('orderBy')).toBe('timestamp.desc')
    expect(upstreamUrl.searchParams.get('limit')).toBe('100')
    expect(body).toEqual([
      {
        agent: 'researcher',
        totalCalls: 2,
        successRate: 50,
        avgLatencyMs: 1000,
        totalCostUsd: 0.03,
        topSkills: ['search', 'summarize'],
      },
      {
        agent: 'writer',
        totalCalls: 1,
        successRate: 100,
        avgLatencyMs: 2000,
        totalCostUsd: 0.03,
        topSkills: ['draft'],
      },
    ])
  })

  it('blocks a customer from reading another tenant agent stats', async () => {
    const { GET } = await import('@/app/api/langfuse/agent-stats/route')

    const response = await GET(request('http://localhost/api/langfuse/agent-stats?tenantId=tenant-other-001'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Access denied' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
