'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TENANT_OPTIONS } from '@/components/panels/budget-settings-block'

type AgentBillingRow = {
  key: string
  calls: number
  totalTokens: number
  estimatedCostUsd: number
  lastCalledAt: string | null
}

type TenantBillingState = {
  tenant: string
  month: string
  budgetUsd: number
  overBudget: boolean
  totals: {
    calls: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimatedCostUsd: number
  }
  byAgent: AgentBillingRow[]
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function numberFrom(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`
}

function normalizeAgentRow(raw: any): AgentBillingRow {
  return {
    key: String(raw?.key || raw?.agent || 'unknown'),
    calls: numberFrom(raw?.calls, 0),
    totalTokens: numberFrom(raw?.totalTokens ?? raw?.total_tokens, 0),
    estimatedCostUsd: numberFrom(raw?.estimatedCostUsd ?? raw?.estimated_cost_usd, 0),
    lastCalledAt: typeof raw?.lastCalledAt === 'string'
      ? raw.lastCalledAt
      : typeof raw?.last_called_at === 'string'
        ? raw.last_called_at
        : null,
  }
}

function normalizeBilling(raw: any, fallbackTenant: string, fallbackMonth: string): TenantBillingState {
  const totals = raw?.totals || {}
  const budget = raw?.budget || {}
  return {
    tenant: String(raw?.tenant || fallbackTenant),
    month: String(raw?.month || fallbackMonth),
    budgetUsd: numberFrom(budget.monthlyBudgetUsd ?? budget.monthly_budget_usd, 0),
    overBudget: Boolean(raw?.overBudget ?? raw?.over_budget),
    totals: {
      calls: numberFrom(totals.calls, 0),
      inputTokens: numberFrom(totals.inputTokens ?? totals.input_tokens, 0),
      outputTokens: numberFrom(totals.outputTokens ?? totals.output_tokens, 0),
      totalTokens: numberFrom(totals.totalTokens ?? totals.total_tokens, 0),
      estimatedCostUsd: numberFrom(totals.estimatedCostUsd ?? totals.estimated_cost_usd, 0),
    },
    byAgent: (Array.isArray(raw?.byAgent) ? raw.byAgent : Array.isArray(raw?.by_agent) ? raw.by_agent : [])
      .map(normalizeAgentRow)
      .sort((left: AgentBillingRow, right: AgentBillingRow) => right.estimatedCostUsd - left.estimatedCostUsd),
  }
}

export function TenantBillingComparison({ initialMonth = currentMonth() }: { initialMonth?: string }) {
  const [tenantId, setTenantId] = useState(TENANT_OPTIONS[0].id)
  const [month, setMonth] = useState(initialMonth)
  const [billing, setBilling] = useState<TenantBillingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadBilling = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/harness/billing/${tenantId}?month=${encodeURIComponent(month)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load tenant billing')
      setBilling(normalizeBilling(data, tenantId, month))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBilling(null)
    } finally {
      setLoading(false)
    }
  }, [month, tenantId])

  useEffect(() => {
    loadBilling()
  }, [loadBilling])

  const usagePercent = useMemo(() => {
    if (!billing || billing.budgetUsd <= 0) return 0
    return Math.min(100, Math.round((billing.totals.estimatedCostUsd / billing.budgetUsd) * 100))
  }, [billing])

  const maxAgentCost = Math.max(...(billing?.byAgent || []).map(row => row.estimatedCostUsd), 0.0001)

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Tenant spend comparison</h2>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">Read-only</span>
            {billing?.overBudget && <span className="rounded bg-red-500/10 px-2 py-0.5 text-[11px] text-red-400">Over budget</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
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
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Month
            <input
              aria-label="Month"
              type="month"
              value={month}
              onChange={event => setMonth(event.target.value || currentMonth())}
              className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground"
            />
          </label>
          <Button type="button" variant="outline" size="sm" onClick={loadBilling} disabled={loading}>
            {loading ? 'Refreshing' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-secondary/30 p-4">
          <div className="text-xs text-muted-foreground">Cost</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{formatUsd(billing?.totals.estimatedCostUsd || 0)}</div>
        </div>
        <div className="rounded-lg border border-border bg-secondary/30 p-4">
          <div className="text-xs text-muted-foreground">Tokens</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{(billing?.totals.totalTokens || 0).toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-border bg-secondary/30 p-4">
          <div className="text-xs text-muted-foreground">Calls</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{(billing?.totals.calls || 0).toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-border bg-secondary/30 p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Budget</span>
            <span>{billing?.budgetUsd ? formatUsd(billing.budgetUsd) : '-'}</span>
          </div>
          <div
            role="progressbar"
            aria-label="Tenant budget usage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usagePercent}
            className="mt-3 h-2 rounded-full bg-background"
          >
            <div
              className={`h-2 rounded-full ${usagePercent >= 80 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">{usagePercent}% used</div>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[minmax(140px,1fr)_90px_120px_110px] gap-3 border-b border-border bg-secondary/40 px-4 py-2 text-xs font-medium text-muted-foreground">
          <div>Agent</div>
          <div className="text-right">Calls</div>
          <div className="text-right">Tokens</div>
          <div className="text-right">Cost</div>
        </div>
        {billing?.byAgent.length ? (
          billing.byAgent.map(row => (
            <div key={row.key} className="grid grid-cols-[minmax(140px,1fr)_90px_120px_110px] items-center gap-3 border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{row.key}</div>
                <div className="mt-1 h-1.5 rounded-full bg-secondary">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(row.estimatedCostUsd / maxAgentCost) * 100}%` }} />
                </div>
              </div>
              <div className="text-right text-muted-foreground">{row.calls.toLocaleString()}</div>
              <div className="text-right text-muted-foreground">{row.totalTokens.toLocaleString()}</div>
              <div className="text-right font-medium text-foreground">{formatUsd(row.estimatedCostUsd)}</div>
            </div>
          ))
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {loading ? 'Loading tenant billing...' : 'No tenant billing records for this month.'}
          </div>
        )}
      </div>
    </section>
  )
}
