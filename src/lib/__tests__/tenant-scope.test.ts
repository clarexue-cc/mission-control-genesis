import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('tenant scope helpers', () => {
  it('clamps monthly budgets to the admin ceiling', async () => {
    const { enforceBudgetCeiling } = await import('@/lib/harness-console-proxy')

    expect(enforceBudgetCeiling({
      monthly_budget_usd: 250,
      alert_at_percent: 85,
      action_on_exceed: 'warn-only',
    }, 100)).toEqual({
      monthly_budget_usd: 100,
      alert_at_percent: 85,
      action_on_exceed: 'warn-only',
    })
  })

  it('does not limit monthly budgets when the ceiling is zero', async () => {
    const { enforceBudgetCeiling } = await import('@/lib/harness-console-proxy')

    expect(enforceBudgetCeiling({ monthly_budget_usd: 250 }, 0)).toEqual({
      monthly_budget_usd: 250,
    })
  })

  it('coerces numeric string budgets before applying the ceiling', async () => {
    const { enforceBudgetCeiling, sanitizeBudgetPayload } = await import('@/lib/harness-console-proxy')

    expect(enforceBudgetCeiling(sanitizeBudgetPayload({ monthly_budget_usd: '75' }), 50)).toEqual({
      monthly_budget_usd: 50,
    })
  })

  it('masks API keys and preserves the last four characters', async () => {
    const { maskApiKey } = await import('@/lib/harness-console-proxy')

    expect(maskApiKey('sk-secret-key-1234')).toBe('sk-...****1234')
    expect(maskApiKey('abcdefg')).toBe('****')
    expect(maskApiKey('')).toBe('')
  })
})