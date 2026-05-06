'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

export const TENANT_OPTIONS = [
  { id: 'ceo-assistant-v1', label: 'CEO Assistant' },
  { id: 'media-intel-v1', label: 'Media Intel' },
  { id: 'web3-research-v1', label: 'Web3 Research' },
  { id: 'tenant-luo-001', label: 'Luo Tenant' },
  { id: 'tenant-vinson-001', label: 'Vinson Tenant' },
  { id: 'tenant-tg-001', label: 'Telegram Tenant' },
]

type BudgetState = {
  monthly_budget_usd: number
  alert_at_percent: number
  action_on_exceed: 'warn' | 'pause'
}

type BillingState = {
  usedUsd: number
  totalTokens: number
  calls: number
}

const DEFAULT_BUDGET: BudgetState = {
  monthly_budget_usd: 0,
  alert_at_percent: 80,
  action_on_exceed: 'pause',
}

function numberFrom(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeBudget(raw: any): BudgetState {
  return {
    monthly_budget_usd: numberFrom(raw?.monthly_budget_usd ?? raw?.monthlyBudgetUsd, 0),
    alert_at_percent: numberFrom(raw?.alert_at_percent ?? raw?.alertAtPercent, 80),
    action_on_exceed: raw?.action_on_exceed === 'warn'
      ? raw.action_on_exceed
      : 'pause',
  }
}

function normalizeBilling(raw: any): BillingState {
  const totals = raw?.totals || {}
  return {
    usedUsd: numberFrom(totals.estimatedCostUsd ?? totals.estimated_cost_usd, 0),
    totalTokens: numberFrom(totals.totalTokens ?? totals.total_tokens, 0),
    calls: numberFrom(totals.calls, 0),
  }
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

export function BudgetSettingsBlock() {
  const [tenantId, setTenantId] = useState(TENANT_OPTIONS[0].id)
  const [budget, setBudget] = useState<BudgetState>(DEFAULT_BUDGET)
  const [billing, setBilling] = useState<BillingState>({ usedUsd: 0, totalTokens: 0, calls: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const loadTenantBudget = useCallback(async () => {
    setLoading(true)
    setError(null)
    setFeedback(null)
    try {
      const [budgetRes, billingRes] = await Promise.all([
        fetch(`/api/harness/budget/${tenantId}`, { cache: 'no-store' }),
        fetch(`/api/harness/billing/${tenantId}`, { cache: 'no-store' }),
      ])
      const [budgetJson, billingJson] = await Promise.all([
        budgetRes.json().catch(() => ({})),
        billingRes.json().catch(() => ({})),
      ])
      if (!budgetRes.ok) throw new Error(budgetJson.error || 'Failed to load tenant budget')
      if (!billingRes.ok) throw new Error(billingJson.error || 'Failed to load tenant billing')
      setBudget(normalizeBudget(budgetJson))
      setBilling(normalizeBilling(billingJson))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBudget(DEFAULT_BUDGET)
      setBilling({ usedUsd: 0, totalTokens: 0, calls: 0 })
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    loadTenantBudget()
  }, [loadTenantBudget])

  const usagePercent = useMemo(() => {
    if (budget.monthly_budget_usd <= 0) return 0
    return Math.min(100, Math.round((billing.usedUsd / budget.monthly_budget_usd) * 100))
  }, [billing.usedUsd, budget.monthly_budget_usd])

  async function saveBudget() {
    setSaving(true)
    setError(null)
    setFeedback(null)
    const payload = {
      monthly_budget_usd: budget.monthly_budget_usd,
      alert_at_percent: budget.alert_at_percent,
      action_on_exceed: budget.action_on_exceed,
    }
    try {
      const res = await fetch(`/api/harness/budget/${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save tenant budget')
      setFeedback('Budget saved')
      await loadTenantBudget()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Tenant budget</h2>
          <p className="mt-1 text-xs text-muted-foreground">Monthly spend guardrail applied through the Genesis Harness tenant proxy.</p>
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Tenant
          <select
            aria-label="Tenant"
            value={tenantId}
            onChange={event => setTenantId(event.target.value)}
            className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground"
          >
            {TENANT_OPTIONS.map(tenant => (
              <option key={tenant.id} value={tenant.id}>{tenant.id}</option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>
      )}
      {feedback && (
        <div className="mt-4 rounded border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">{feedback}</div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-4">
          <label className="grid gap-2 text-xs font-medium text-muted-foreground">
            <span className="flex items-center justify-between">
              <span>Monthly budget</span>
              <span className="font-mono text-foreground">{formatUsd(budget.monthly_budget_usd)}</span>
            </span>
            <input
              aria-label="Monthly budget"
              type="range"
              min="0"
              max="500"
              step="5"
              value={budget.monthly_budget_usd}
              onChange={event => setBudget(prev => ({ ...prev, monthly_budget_usd: numberFrom(event.target.value) }))}
              className="w-full accent-primary"
              disabled={loading || saving}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Alert threshold
              <input
                aria-label="Alert threshold"
                type="number"
                min="1"
                max="100"
                value={budget.alert_at_percent}
                onChange={event => setBudget(prev => ({ ...prev, alert_at_percent: numberFrom(event.target.value, 80) }))}
                className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground"
                disabled={loading || saving}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Overage action
              <select
                aria-label="Overage action"
                value={budget.action_on_exceed}
                onChange={event => setBudget(prev => ({ ...prev, action_on_exceed: event.target.value as BudgetState['action_on_exceed'] }))}
                className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground"
                disabled={loading || saving}
              >
                <option value="warn">Warn only</option>
                <option value="pause">Pause tenant</option>
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-secondary/40 p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Month usage</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{formatUsd(billing.usedUsd)} used</div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div>{billing.calls.toLocaleString()} calls</div>
              <div>{billing.totalTokens.toLocaleString()} tokens</div>
            </div>
          </div>
          <div
            role="progressbar"
            aria-label="Monthly budget usage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usagePercent}
            className="mt-4 h-2 rounded-full bg-background"
          >
            <div
              className={`h-2 rounded-full ${usagePercent >= budget.alert_at_percent ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>{usagePercent}%</span>
            <span>{budget.alert_at_percent}% alert</span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={loadTenantBudget} disabled={loading || saving}>
          {loading ? 'Refreshing' : 'Refresh'}
        </Button>
        <Button type="button" size="sm" onClick={saveBudget} disabled={loading || saving}>
          {saving ? 'Saving' : 'Save budget'}
        </Button>
      </div>
    </section>
  )
}
