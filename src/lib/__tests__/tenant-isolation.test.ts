import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { proxyHarnessConsoleJson } from '@/lib/harness-console-proxy'

vi.mock('server-only', () => ({}))

describe('harness console tenant isolation', () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  beforeEach(() => {
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
  })

  it('injects X-Tenant-Id for customer roles', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const response = await proxyHarnessConsoleJson({
      method: 'GET',
      path: '/providers',
      search: new URLSearchParams({ tenantId: 'tenant-owned-007' }),
      requestedTenantId: 'tenant-owned-007',
      user: { role: 'customer-user', tenant_id: 'tenant-owned-007' },
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/providers?tenantId=tenant-owned-007',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Tenant-Id': 'tenant-owned-007',
        }),
      }),
    )
  })

  it('rejects customer access to a different tenant before proxying', async () => {
    const response = await proxyHarnessConsoleJson({
      method: 'GET',
      path: '/providers',
      requestedTenantId: 'tenant-other-001',
      user: { role: 'customer-admin', tenant_id: 'tenant-owned-007' },
    })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Forbidden tenant access')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lets admin access any tenant without forcing X-Tenant-Id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const response = await proxyHarnessConsoleJson({
      method: 'POST',
      path: '/providers',
      body: { tenantId: 'tenant-other-001', name: 'openai' },
      requestedTenantId: 'tenant-other-001',
      user: { role: 'admin', tenant_id: 'tenant-owned-007' },
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/providers',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-Tenant-Id': expect.any(String),
        }),
      }),
    )
  })
})
