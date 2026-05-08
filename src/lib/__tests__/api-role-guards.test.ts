import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authMock = vi.hoisted(() => ({
  currentRole: 'customer-user',
  requireRole: vi.fn(),
}))

const proxyMock = vi.hoisted(() => ({
  proxyHarnessConsoleJson: vi.fn(),
}))

const dbMock = vi.hoisted(() => ({
  prepare: vi.fn(),
}))

const roleLevels: Record<string, number> = {
  viewer: 0,
  'customer-user': 0,
  customer: 1,
  'customer-admin': 1,
  operator: 2,
  admin: 3,
}

function installRequireRole() {
  authMock.requireRole.mockImplementation((_request: Request, minRole: string) => {
    const role = authMock.currentRole
    if ((roleLevels[role] ?? -1) < (roleLevels[minRole] ?? 999)) {
      return { error: `Requires ${minRole} role or higher`, status: 403 }
    }
    return {
      user: {
        id: 1,
        username: role,
        display_name: role,
        role,
        workspace_id: 1,
        tenant_id: 1,
        created_at: 0,
        updated_at: 0,
        last_login_at: null,
      },
    }
  })
}

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init)
}

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({
    prepare: dbMock.prepare,
  })),
  db_helpers: {
    createNotification: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    logActivity: vi.fn(),
  },
}))

vi.mock('@/lib/harness-console-proxy', () => ({
  enforceBudgetCeiling: vi.fn((payload: unknown) => payload),
  maskApiKey: vi.fn((value: string) => value.replace(/^(.{4}).*(.{4})$/u, '$1****$2')),
  normalizeConsoleMonth: vi.fn((value: unknown) => String(value || '')),
  normalizeConsoleTenantId: vi.fn((value: unknown) => String(value || 'tenant-owned-001')),
  normalizeProviderName: vi.fn((value: unknown) => String(value || 'openai')),
  proxyHarnessConsoleJson: proxyMock.proxyHarnessConsoleJson,
  readJsonObject: vi.fn(async (request: Request) => request.json()),
  resolveHarnessConsoleBaseUrl: vi.fn(() => 'http://harness.local:3088'),
  routeParams: vi.fn(async (params: unknown) => params instanceof Promise ? await params : params),
  sanitizeBudgetPayload: vi.fn((payload: unknown) => payload),
  sanitizeProviderPayload: vi.fn((payload: unknown) => payload),
}))

vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/validation', () => ({
  bulkUpdateTaskStatusSchema: {},
  createTaskSchema: {},
  validateBody: vi.fn(async () => ({ data: {} })),
}))
vi.mock('@/lib/mentions', () => ({ resolveMentionRecipients: vi.fn(() => ({ recipients: [], unresolved: [] })) }))
vi.mock('@/lib/task-status', () => ({ normalizeTaskCreateStatus: vi.fn((status: string) => status || 'todo') }))
vi.mock('@/lib/github-sync-engine', () => ({ pushTaskToGitHub: vi.fn(), syncTaskOutbound: vi.fn() }))
vi.mock('@/lib/gnap-sync', () => ({ pushTaskToGnap: vi.fn() }))
vi.mock('@/lib/config', () => ({ config: { gnap: { enabled: false, autoSync: false, repoPath: '' } } }))

describe('API role guards for dual customer roles', () => {
  beforeEach(() => {
    vi.resetModules()
    authMock.currentRole = 'customer-user'
    authMock.requireRole.mockReset()
    installRequireRole()
    proxyMock.proxyHarnessConsoleJson.mockReset()
    proxyMock.proxyHarnessConsoleJson.mockResolvedValue(Response.json({ ok: true }))
    dbMock.prepare.mockReset()
    dbMock.prepare.mockImplementation((sql: string) => {
      if (sql.includes('SELECT COUNT(*) as total FROM tasks')) return { get: vi.fn(() => ({ total: 0 })) }
      return { all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() }
    })
  })

  it('blocks customer-user from the budget API', async () => {
    authMock.currentRole = 'customer-user'
    const { GET } = await import('@/app/api/harness/budget/[tenantId]/route')

    const response = await GET(request('http://localhost/api/harness/budget/tenant-owned-001'), {
      params: Promise.resolve({ tenantId: 'tenant-owned-001' }),
    })

    expect(response.status).toBe(403)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'customer-admin')
    expect(proxyMock.proxyHarnessConsoleJson).not.toHaveBeenCalled()
  })

  it('allows customer-admin to call the budget API', async () => {
    authMock.currentRole = 'customer-admin'
    const { GET } = await import('@/app/api/harness/budget/[tenantId]/route')

    const response = await GET(request('http://localhost/api/harness/budget/tenant-owned-001'), {
      params: Promise.resolve({ tenantId: 'tenant-owned-001' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'customer-admin')
  })

  it('allows customer-user to read the tasks API', async () => {
    authMock.currentRole = 'customer-user'
    const { GET } = await import('@/app/api/tasks/route')

    const response = await GET(request('http://localhost/api/tasks'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.tasks).toEqual([])
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'customer-user')
  })
})
