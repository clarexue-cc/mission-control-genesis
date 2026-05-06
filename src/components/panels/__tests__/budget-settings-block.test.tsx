import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BudgetSettingsBlock } from '@/components/panels/budget-settings-block'

describe('BudgetSettingsBlock', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/harness/budget/ceo-assistant-v1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            monthly_budget_usd: 80,
            alert_at_percent: 75,
            action_on_exceed: 'pause',
          }),
        })
      }
      if (url === '/api/harness/billing/ceo-assistant-v1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tenant: 'ceo-assistant-v1',
            totals: { estimatedCostUsd: 20, totalTokens: 4000, calls: 12 },
            byAgent: [{ key: 'Agent-Main', estimatedCostUsd: 20, totalTokens: 4000 }],
          }),
        })
      }
      if (url === '/api/harness/budget/ceo-assistant-v1' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ saved: true }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads a tenant budget, shows spend progress, and saves changed limits', async () => {
    render(<BudgetSettingsBlock />)

    expect(await screen.findByRole('heading', { name: 'Tenant budget', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Tenant' })).toHaveValue('ceo-assistant-v1')
    expect(screen.getByRole('slider', { name: 'Monthly budget' })).toHaveValue('80')
    expect(screen.getByRole('spinbutton', { name: 'Alert threshold' })).toHaveValue(75)
    expect(screen.getByRole('progressbar', { name: 'Monthly budget usage' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('$20.00 used')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('slider', { name: 'Monthly budget' }), { target: { value: '120' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Alert threshold' }), { target: { value: '85' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Overage action' }), { target: { value: 'warn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }))

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/harness/budget/ceo-assistant-v1', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          monthly_budget_usd: 120,
          alert_at_percent: 85,
          action_on_exceed: 'warn',
        }),
      }))
    })
  })
})
