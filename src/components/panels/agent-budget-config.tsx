'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'

type AlertStatus = 'unconfigured' | 'healthy' | 'warning' | 'critical' | 'exceeded'
type AgentBudgetAction = 'pause' | 'warn-only' | 'block-new-only'

export interface TenantBudgetSnapshot {
  tenantId: string
  month: string
  budget: {
    monthlyBudgetUsd: number
    alertAtPercent: number
    actionOnExceed: string
  }
  usage: {
    totalCostUsd: number
    totalTokens: number
    requestCount: number
    inputTokens: number
    outputTokens: number
    remainingUsd: number | null
    burnRateDailyUsd: number
    percentUsed: number
  }
  alert: {
    status: AlertStatus
    label: string
    threshold: number | null
  }
  agents: Array<{
    agent: string
    usedUsd: number
    totalTokens: number
    requestCount: number
    inputTokens: number
    outputTokens: number
    lastActiveAt: string | null
    remainingUsd: number | null
    burnRateDailyUsd: number
    percentUsed: number
    budget: {
      monthlyBudgetUsd: number
      thresholds: [number, number, number]
      action: AgentBudgetAction
    }
    alert: {
      status: AlertStatus
      label: string
      threshold: number | null
    }
  }>
}

interface AgentBudgetConfigProps {
  tenantId: string | null
  agentName: string
  snapshot?: TenantBudgetSnapshot | null
  onSaved?: (snapshot: TenantBudgetSnapshot) => void
  compact?: boolean
}

const DEFAULT_THRESHOLDS: [number, number, number] = [80, 95, 100]

function formatUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '--'
  return `$${value.toFixed(2)}`
}

function formatCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value || 0)
}

function progressTone(status: AlertStatus) {
  if (status === 'exceeded') return 'bg-red-500'
  if (status === 'critical') return 'bg-orange-500'
  if (status === 'warning') return 'bg-yellow-500'
  if (status === 'unconfigured') return 'bg-slate-500'
  return 'bg-emerald-500'
}

function percentLabel(percentUsed: number) {
  if (!Number.isFinite(percentUsed) || percentUsed <= 0) return '0%'
  return `${Math.min(percentUsed, 999).toFixed(percentUsed >= 100 ? 0 : 1)}%`
}

export function AgentBudgetConfig({ tenantId, agentName, snapshot, onSaved, compact = false }: AgentBudgetConfigProps) {
  const [localSnapshot, setLocalSnapshot] = useState<TenantBudgetSnapshot | null>(snapshot || null)
  const [loading, setLoading] = useState(Boolean(tenantId) && !snapshot)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [budgetUsd, setBudgetUsd] = useState('0')
  const [warningAt, setWarningAt] = useState(String(DEFAULT_THRESHOLDS[0]))
  const [criticalAt, setCriticalAt] = useState(String(DEFAULT_THRESHOLDS[1]))
  const [hardAt, setHardAt] = useState(String(DEFAULT_THRESHOLDS[2]))
  const [action, setAction] = useState<AgentBudgetAction>('pause')

  const effectiveSnapshot = snapshot || localSnapshot
  const agentBudget = useMemo(() => {
    return effectiveSnapshot?.agents.find((entry) => entry.agent === agentName) || null
  }, [effectiveSnapshot, agentName])

  useEffect(() => {
    if (!agentBudget) {
      setBudgetUsd('0')
      setWarningAt(String(DEFAULT_THRESHOLDS[0]))
      setCriticalAt(String(DEFAULT_THRESHOLDS[1]))
      setHardAt(String(DEFAULT_THRESHOLDS[2]))
      setAction('pause')
      return
    }
    setBudgetUsd(String(agentBudget.budget.monthlyBudgetUsd || 0))
    setWarningAt(String(agentBudget.budget.thresholds[0] || DEFAULT_THRESHOLDS[0]))
    setCriticalAt(String(agentBudget.budget.thresholds[1] || DEFAULT_THRESHOLDS[1]))
    setHardAt(String(agentBudget.budget.thresholds[2] || DEFAULT_THRESHOLDS[2]))
    setAction(agentBudget.budget.action)
  }, [agentBudget])

  useEffect(() => {
    if (snapshot) {
      setLocalSnapshot(snapshot)
    }
  }, [snapshot])

  useEffect(() => {
    if (!tenantId || snapshot) return
    let cancelled = false

    async function loadSnapshot() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/budget?tenantId=${encodeURIComponent(tenantId)}`, { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Failed to load agent budget')
        if (!cancelled) setLocalSnapshot(payload as TenantBudgetSnapshot)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadSnapshot().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tenantId, snapshot])

  const sliderMax = Math.max(100, Math.ceil(Math.max(Number(budgetUsd) || 0, agentBudget?.usedUsd || 0, 50) * 1.5))

  async function saveConfig() {
    if (!tenantId || !effectiveSnapshot) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          agentBudget: {
            agent: agentName,
            monthlyBudgetUsd: Number(budgetUsd) || 0,
            thresholds: [Number(warningAt) || DEFAULT_THRESHOLDS[0], Number(criticalAt) || DEFAULT_THRESHOLDS[1], Number(hardAt) || DEFAULT_THRESHOLDS[2]],
            action,
          },
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to save agent budget')
      const nextSnapshot = payload as TenantBudgetSnapshot
      setLocalSnapshot(nextSnapshot)
      onSaved?.(nextSnapshot)
      setSuccess('已保存')
      window.setTimeout(() => setSuccess(null), 2000)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  if (!tenantId) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
        先选择 tenant，才能配置这个 Agent 的预算。
      </div>
    )
  }

  if (loading && !effectiveSnapshot) {
    return <Loader variant="panel" label={`Loading budget for ${agentName}`} />
  }

  return (
    <section className={`rounded-lg border border-border bg-card/70 ${compact ? 'p-4' : 'p-5'} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{agentName}</h3>
          <p className="mt-1 text-xs text-muted-foreground">月预算、阈值与超支动作都在这里配置。</p>
        </div>
        <div className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
          {agentBudget?.alert.label || '未设置'}
        </div>
      </div>

      {(error || success) && (
        <div className={`rounded-md border px-3 py-2 text-xs ${error ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
          {error || success}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-md bg-background/80 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">已用</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{formatUsd(agentBudget?.usedUsd || 0)}</div>
        </div>
        <div className="rounded-md bg-background/80 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">剩余</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{formatUsd(agentBudget?.remainingUsd)}</div>
        </div>
        <div className="rounded-md bg-background/80 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">日均速率</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{formatUsd(agentBudget?.burnRateDailyUsd || 0)}</div>
        </div>
        <div className="rounded-md bg-background/80 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Tokens / Req</div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {agentBudget ? `${formatCount(agentBudget.totalTokens)} / ${formatCount(agentBudget.requestCount)}` : '--'}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>预算进度</span>
          <span>{percentLabel(agentBudget?.percentUsed || 0)}</span>
        </div>
        <div className="h-2.5 rounded-full bg-secondary">
          <div
            className={`h-2.5 rounded-full transition-all ${progressTone(agentBudget?.alert.status || 'unconfigured')}`}
            style={{ width: `${Math.min(agentBudget?.percentUsed || 0, 100)}%` }}
          />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_120px]">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">月预算（USD）</div>
          <input
            type="range"
            min="0"
            max={sliderMax}
            step="5"
            value={Number(budgetUsd) || 0}
            onChange={(event) => setBudgetUsd(event.target.value)}
            className="w-full"
          />
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          金额
          <input
            type="number"
            min="0"
            step="1"
            value={budgetUsd}
            onChange={(event) => setBudgetUsd(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          告警阈值
          <input type="number" min="1" max="100" value={warningAt} onChange={(event) => setWarningAt(event.target.value)} className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          临界阈值
          <input type="number" min="1" max="100" value={criticalAt} onChange={(event) => setCriticalAt(event.target.value)} className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          硬阈值
          <input type="number" min="1" max="100" value={hardAt} onChange={(event) => setHardAt(event.target.value)} className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground" />
        </label>
      </div>

      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        超支动作
        <select value={action} onChange={(event) => setAction(event.target.value as AgentBudgetAction)} className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground">
          <option value="pause">pause</option>
          <option value="warn-only">warn-only</option>
          <option value="block-new-only">block-new-only</option>
        </select>
      </label>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>{effectiveSnapshot?.month || '--'} 月 · {formatCount(agentBudget?.requestCount || 0)} 次调用</span>
        <Button onClick={saveConfig} size={compact ? 'sm' : 'default'} disabled={saving || !effectiveSnapshot}>
          {saving ? 'Saving...' : '保存'}
        </Button>
      </div>
    </section>
  )
}