import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const storeState = vi.hoisted(() => ({
  activeTenant: {
    id: 1,
    slug: 'acme',
    name: 'acme',
    display_name: 'ACME Intelligence',
    base: 'hermes' as const,
  },
}))

vi.mock('@/store', () => ({
  useMissionControl: () => ({
    activeTenant: storeState.activeTenant,
  }),
}))

import { GateTestingPanel } from '@/components/panels/gate-testing-panel'
import { OnboardingDeliveryPanel } from '@/components/panels/onboarding-delivery-panel'
import { PreLaunchPanel } from '@/components/panels/pre-launch-panel'

function mockFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('shared onboarding panels', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    storeState.activeTenant.base = 'hermes'
  })

  it('loads gate checks with the active tenant base', async () => {
    const fetchMock = mockFetch({
      available: true,
      tenants: ['acme'],
      base: 'hermes',
      tenant: { tenant_id: 'acme', tenant_name: 'ACME Intelligence' },
      phase: { id: 'P10', label: '闸门测试', description: '' },
      summary: { total_checks: 0, pass: 0, warn: 0, fail: 0, pending: 0, blocking: 0, status: 'pass' },
      checks: [],
    })

    render(<GateTestingPanel />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/harness/gates?tenant=acme&base=hermes')
  })

  it('loads pre-launch checks with the active tenant base', async () => {
    const fetchMock = mockFetch({
      available: true,
      tenants: ['acme'],
      base: 'hermes',
      tenant: { tenant_id: 'acme', tenant_name: 'ACME Intelligence' },
      phase: { id: 'P12', label: '上线准备', description: '' },
      rules: { path: null, version: 'test', total: 0 },
      readiness: { status: 'ready', label: 'Ready to Ship', blocking: 0, warning: 0 },
      checks: [],
    })

    render(<PreLaunchPanel />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/harness/pre-launch?tenant=acme&base=hermes')
  })

  it('loads delivery reports with the active tenant base', async () => {
    const fetchMock = mockFetch({
      available: true,
      tenants: ['acme'],
      base: 'hermes',
      tenant: { tenant_id: 'acme', tenant_name: 'ACME Intelligence' },
      phase: { id: 'P16', label: '验收交付', description: '' },
      report: { status: 'ready', pass: 0, warn: 0, pending: 0, fail: 0, total: 0, summary: 'ready' },
      sections: [],
    })

    render(<OnboardingDeliveryPanel />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/harness/delivery-report?tenant=acme&base=hermes')
  })
})
