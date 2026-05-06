import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TenantBillingComparison } from '@/components/panels/tenant-billing-comparison'

describe('TenantBillingComparison', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/harness/billing/ceo-assistant-v1?month=2026-05') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tenant: 'ceo-assistant-v1',
            month: '2026-05',
            budget: { monthlyBudgetUsd: 100, actionOnExceed: 'pause' },
            totals: { calls: 6, inputTokens: 1200, outputTokens: 900, totalTokens: 2100, estimatedCostUsd: 12.5 },
            byAgent: [
              { key: 'Agent-Main', calls: 4, totalTokens: 1400, estimatedCostUsd: 8.25, lastCalledAt: '2026-05-06T01:00:00Z' },
              { key: 'Agent-Research', calls: 2, totalTokens: 700, estimatedCostUsd: 4.25, lastCalledAt: '2026-05-06T02:00:00Z' },
            ],
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows tenant-scoped billing and a read-only per-agent comparison', async () => {
    render(<TenantBillingComparison initialMonth="2026-05" />)

    expect(await screen.findByRole('heading', { name: 'Tenant spend comparison', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Tenant' })).toHaveValue('ceo-assistant-v1')
    expect(screen.getByLabelText('Month')).toHaveValue('2026-05')
    expect(screen.getByText('$12.50')).toBeInTheDocument()
    expect(screen.getByText('2,100')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Tenant budget usage' })).toHaveAttribute('aria-valuenow', '13')
    expect(screen.getByText('Agent-Main')).toBeInTheDocument()
    expect(screen.getByText('Agent-Research')).toBeInTheDocument()
    expect(screen.getByText('$8.25')).toBeInTheDocument()
    expect(screen.getByText('$4.25')).toBeInTheDocument()

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/harness/billing/ceo-assistant-v1?month=2026-05', { cache: 'no-store' })
    })
  })
})
