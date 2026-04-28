import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

const dbMock = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const hermesMock = vi.hoisted(() => ({
  getAggregatedHermesAlerts: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbMock.getDatabase,
}))

vi.mock('@/lib/hermes-alerts', () => ({
  getAggregatedHermesAlerts: hermesMock.getAggregatedHermesAlerts,
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

function user(role = 'admin') {
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

function request(query = '') {
  return new NextRequest(`http://localhost/api/alerts${query}`)
}

async function loadGet() {
  vi.resetModules()
  const route = await import('@/app/api/alerts/route')
  return route.GET
}

describe('GET /api/alerts aggregated feed', () => {
  beforeEach(() => {
    authMock.requireRole.mockReset()
    dbMock.getDatabase.mockReset()
    hermesMock.getAggregatedHermesAlerts.mockReset()
    authMock.requireRole.mockReturnValue({ user: user() })
    hermesMock.getAggregatedHermesAlerts.mockResolvedValue([
      {
        id: 'hermes-1',
        timestamp: Date.parse('2026-04-27T13:02:56Z'),
        severity: 'high',
        title: '卡死告警',
        message: 'working-context.md stale',
        source: 'hermes',
        source_label: 'Hermes vault',
        source_type: 'hermes-alert',
        acknowledged: false,
        jump_href: '/hermes',
      },
    ])
    dbMock.getDatabase.mockReturnValue({
      prepare: vi.fn((sql: string) => ({
        all: vi.fn((workspaceId: number) => {
          if (sql.includes('alert_rules')) return [{ id: 1, name: 'Rule A', workspace_id: workspaceId }]
          if (sql.includes('notifications')) {
            return [
              {
                id: 2,
                type: 'alert',
                title: 'System alert',
                message: 'test alert fired',
                source_type: 'test',
                source_id: 3,
                read_at: null,
                created_at: 1_777_286_400,
              },
            ]
          }
          return []
        }),
      })),
    })
  })

  it('returns alert rules plus Hermes and notification alerts', async () => {
    const GET = await loadGet()

    const response = await GET(request('?tenant=tenant-demo'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.any(NextRequest), 'viewer')
    expect(hermesMock.getAggregatedHermesAlerts).toHaveBeenCalledWith({ tenant: 'tenant-demo', limit: 50 })
    expect(body.rules).toHaveLength(1)
    expect(body.alerts).toHaveLength(2)
    expect(body.alerts.map((alert: any) => alert.source)).toEqual(['hermes', 'test'])
    expect(body.alerts[0].title).toBe('卡死告警')
  })

  it('can return only rules when alert aggregation is disabled', async () => {
    const GET = await loadGet()

    const response = await GET(request('?include_alerts=false'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(hermesMock.getAggregatedHermesAlerts).not.toHaveBeenCalled()
    expect(body.rules).toHaveLength(1)
    expect(body.alerts).toEqual([])
  })

  it('enforces viewer RBAC', async () => {
    authMock.requireRole.mockReturnValueOnce({ error: 'Authentication required', status: 401 })
    const GET = await loadGet()

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.any(NextRequest), 'viewer')
  })

  it('returns 400 for invalid Hermes tenant filters', async () => {
    hermesMock.getAggregatedHermesAlerts.mockRejectedValueOnce(new Error('Invalid tenant'))
    const GET = await loadGet()

    const response = await GET(request('?tenant=../secret'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid tenant')
  })
})
