'use client'

import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import type { CostBudgetRule, CostBudgetSummary } from '@/lib/cost-budget-controls'
import { type TenantBudgetSnapshot } from '@/components/panels/agent-budget-config'
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from 'recharts'

const log = createClientLogger('CostTracker')

// ── Types ──────────────────────────────────────────

interface TokenStats {
  totalTokens: number; totalCost: number; requestCount: number
  avgTokensPerRequest: number; avgCostPerRequest: number
}

interface UsageStats {
  summary: TokenStats
  models: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  sessions: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  timeframe: string
  recordCount: number
}

interface TrendData {
  trends: Array<{ timestamp: string; tokens: number; cost: number; requests: number }>
  timeframe: string
}

interface ByAgentModelBreakdown {
  model: string; input_tokens: number; output_tokens: number; request_count: number; cost: number
}

interface ByAgentEntry {
  agent: string; total_input_tokens: number; total_output_tokens: number
  total_tokens: number; total_cost: number; session_count: number
  request_count: number; last_active: string; models: ByAgentModelBreakdown[]
}

interface ByAgentResponse {
  agents: ByAgentEntry[]
  summary: { total_cost: number; total_tokens: number; agent_count: number; days: number }
}

interface TaskCostEntry {
  taskId: number; title: string; status: string; priority: string
  assignedTo?: string | null
  project: { id?: number | null; name?: string | null; slug?: string | null; ticketRef?: string | null }
  stats: TokenStats
  models: Record<string, TokenStats>
}

interface TaskCostsResponse {
  summary: TokenStats
  tasks: TaskCostEntry[]
  agents: Record<string, { stats: TokenStats; taskCount: number; taskIds: number[] }>
  unattributed: TokenStats
  timeframe: string
}

interface SessionCostEntry {
  sessionId: string; sessionKey?: string; model: string
  totalTokens: number; inputTokens: number; outputTokens: number
  totalCost: number; requestCount: number; firstSeen: string; lastSeen: string
}

interface BudgetRulesResponse {
  rules: CostBudgetRule[]
  summary: CostBudgetSummary
  error?: string
}

// ── Helpers ──────────────────────────────────────────

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff6b6b']

const formatNumber = (num: number) => {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toString()
}

const formatCost = (cost: number) => '$' + cost.toFixed(4)

const getModelDisplayName = (name: string) => name.split('/').pop() || name

type View = 'overview' | 'agents' | 'sessions' | 'tasks' | 'controls'
type Timeframe = 'hour' | 'day' | 'week' | 'month'

const VIEW_LABELS: Record<View, string> = {
  overview: 'Overview',
  agents: 'Agents',
  sessions: 'Sessions',
  tasks: 'Tasks',
  controls: '预算',
}

const ALL_TENANTS_SCOPE = 'all'
const CURRENT_TENANT_SCOPE = 'current'

function alertTone(status: TenantBudgetSnapshot['alert']['status']) {
  if (status === 'exceeded') return 'bg-red-500 text-red-50'
  if (status === 'critical') return 'bg-orange-500 text-orange-50'
  if (status === 'warning') return 'bg-yellow-500 text-yellow-950'
  if (status === 'unconfigured') return 'bg-slate-500 text-slate-50'
  return 'bg-emerald-500 text-emerald-50'
}

function alertBarTone(status: TenantBudgetSnapshot['alert']['status']) {
  if (status === 'exceeded') return 'bg-red-500'
  if (status === 'critical') return 'bg-orange-500'
  if (status === 'warning') return 'bg-yellow-500'
  if (status === 'unconfigured') return 'bg-slate-500'
  return 'bg-emerald-500'
}

function formatBudgetPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  return `${Math.min(value, 999).toFixed(value >= 100 ? 0 : 1)}%`
}

// ── Main Component ──────────────────────────────────

export function CostTrackerPanel() {
  const t = useTranslations('costTracker')
  const { sessions, tenants, activeTenant, currentUser, fetchTenants } = useMissionControl()

  const [view, setView] = useState<View>('overview')
  const [timeframe, setTimeframe] = useState<Timeframe>('day')
  const [chartMode, setChartMode] = useState<'incremental' | 'cumulative'>('incremental')
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [tenantScope, setTenantScope] = useState<string>(ALL_TENANTS_SCOPE)
  const [tenantSnapshots, setTenantSnapshots] = useState<Record<string, TenantBudgetSnapshot>>({})
  const [tenantBudgetLoading, setTenantBudgetLoading] = useState(false)
  const [tenantBudgetError, setTenantBudgetError] = useState<string | null>(null)

  // Data
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [byAgentData, setByAgentData] = useState<ByAgentResponse | null>(null)
  const [taskData, setTaskData] = useState<TaskCostsResponse | null>(null)
  const [sessionCosts, setSessionCosts] = useState<SessionCostEntry[]>([])
  const [sessionSort, setSessionSort] = useState<'cost' | 'tokens' | 'requests' | 'recent'>('cost')
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [budgetRules, setBudgetRules] = useState<CostBudgetRule[]>([])
  const [budgetSummary, setBudgetSummary] = useState<CostBudgetSummary | null>(null)
  const [budgetLoading, setBudgetLoading] = useState(false)
  const [budgetError, setBudgetError] = useState<string | null>(null)

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const timeframeToDays = (tf: Timeframe): number => {
    switch (tf) { case 'hour': case 'day': return 1; case 'week': return 7; case 'month': return 30 }
  }

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [statsRes, trendRes, byAgentRes, taskRes] = await Promise.all([
        fetch(`/api/tokens?action=stats&timeframe=${timeframe}`),
        fetch(`/api/tokens?action=trends&timeframe=${timeframe}`),
        fetch(`/api/tokens/by-agent?days=${timeframeToDays(timeframe)}`),
        fetch(`/api/tokens?action=task-costs&timeframe=${timeframe}`),
      ])
      const [statsJson, trendJson, byAgentJson, taskJson] = await Promise.all([
        statsRes.json(), trendRes.json(), byAgentRes.json(), taskRes.json(),
      ])
      setUsageStats(statsJson)
      setTrendData(trendJson)
      setByAgentData(byAgentJson)
      setTaskData(taskJson)
    } catch (err) {
      log.error('Failed to load cost data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [timeframe])

  const loadSessionCosts = useCallback(async () => {
    try {
      const res = await fetch(`/api/tokens?action=session-costs&timeframe=${timeframe}`)
      const data = await res.json()
      if (Array.isArray(data?.sessions)) {
        setSessionCosts(data.sessions)
      } else if (usageStats?.sessions) {
        setSessionCosts(Object.entries(usageStats.sessions).map(([id, stats]) => ({
          sessionId: id, model: '', totalTokens: stats.totalTokens, inputTokens: 0,
          outputTokens: 0, totalCost: stats.totalCost, requestCount: stats.requestCount,
          firstSeen: '', lastSeen: '',
        })))
      }
    } catch {
      if (usageStats?.sessions) {
        setSessionCosts(Object.entries(usageStats.sessions).map(([id, stats]) => ({
          sessionId: id, model: '', totalTokens: stats.totalTokens, inputTokens: 0,
          outputTokens: 0, totalCost: stats.totalCost, requestCount: stats.requestCount,
          firstSeen: '', lastSeen: '',
        })))
      }
    }
  }, [timeframe, usageStats])

  const loadBudgetRules = useCallback(async () => {
    setBudgetLoading(true)
    setBudgetError(null)
    try {
      const res = await fetch('/api/tokens/budgets', { cache: 'no-store' })
      const data = await res.json() as BudgetRulesResponse
      if (!res.ok) throw new Error(data.error || 'Failed to load budget controls')
      setBudgetRules(Array.isArray(data.rules) ? data.rules : [])
      setBudgetSummary(data.summary || null)
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : String(err))
    } finally {
      setBudgetLoading(false)
    }
  }, [])

  const loadTenantBudgets = useCallback(async () => {
    const isAdmin = currentUser?.role === 'admin'
    if (tenants.length === 0 && isAdmin && tenantScope === ALL_TENANTS_SCOPE) {
      setTenantSnapshots({})
      return
    }

    setTenantBudgetLoading(true)
    setTenantBudgetError(null)
    try {
      const targets = tenantScope === ALL_TENANTS_SCOPE ? tenants.map((tenant) => tenant.slug) : [tenantScope]
      const results = await Promise.all(targets.map(async (tenantId) => {
        const response = await fetch(`/api/budget?tenantId=${encodeURIComponent(tenantId)}`, { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || `Failed to load tenant budget for ${tenantId}`)
        return payload as TenantBudgetSnapshot
      }))

      setTenantSnapshots((prev) => {
        const next = tenantScope === ALL_TENANTS_SCOPE ? {} : { ...prev }
        for (const snapshot of results) {
          next[snapshot.tenantId] = snapshot
        }
        return next
      })
    } catch (err) {
      setTenantBudgetError(err instanceof Error ? err.message : String(err))
    } finally {
      setTenantBudgetLoading(false)
    }
  }, [currentUser?.role, tenantScope, tenants])

  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin' && tenantScope === ALL_TENANTS_SCOPE) {
      setTenantScope(CURRENT_TENANT_SCOPE)
    }
  }, [currentUser, tenantScope])

  useEffect(() => {
    if (tenantScope !== ALL_TENANTS_SCOPE) {
      setIsLoading(false)
      return
    }
    loadData()
  }, [loadData, tenantScope])
  useEffect(() => { fetchTenants().catch(() => {}) }, [fetchTenants])
  useEffect(() => {
    if (tenantScope !== ALL_TENANTS_SCOPE) {
      if (refreshTimer.current) clearInterval(refreshTimer.current)
      return
    }
    refreshTimer.current = setInterval(loadData, 30_000)
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [loadData, tenantScope])
  useEffect(() => {
    if (tenantScope !== ALL_TENANTS_SCOPE) {
      setSessionCosts([])
      return
    }
    if (view === 'sessions') loadSessionCosts()
  }, [view, loadSessionCosts, tenantScope])
  useEffect(() => {
    if (tenantScope !== ALL_TENANTS_SCOPE) {
      setBudgetRules([])
      setBudgetSummary(null)
      setBudgetLoading(false)
      setBudgetError(null)
      return
    }
    loadBudgetRules()
  }, [loadBudgetRules, tenantScope])
  useEffect(() => { loadTenantBudgets().catch(() => {}) }, [loadTenantBudgets])

  const exportData = async (format: 'json' | 'csv') => {
    setIsExporting(true)
    try {
      const res = await fetch(`/api/tokens?action=export&timeframe=${timeframe}&format=${format}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'; a.href = url
      a.download = `cost-tracker-${timeframe}-${new Date().toISOString().split('T')[0]}.${format}`
      document.body.appendChild(a); a.click()
      window.URL.revokeObjectURL(url); document.body.removeChild(a)
    } catch (err) {
      log.error('Export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }

  // Derived data
  const summary = usageStats?.summary
  const agentSummary = byAgentData?.summary
  const agentList = byAgentData?.agents || []
  const maxAgentCost = Math.max(...agentList.map(a => a.total_cost), 0.0001)
  const selectedTenantSnapshot = tenantScope === ALL_TENANTS_SCOPE ? null : tenantSnapshots[tenantScope] || null
  const selectedTenant = tenantScope === CURRENT_TENANT_SCOPE
    ? activeTenant
    : tenants.find((tenant) => tenant.slug === tenantScope) || activeTenant || null

  const getAgentTasks = (agentName: string): TaskCostEntry[] => {
    if (!taskData) return []
    const entry = taskData.agents[agentName]
    if (!entry) return []
    return taskData.tasks.filter(t => entry.taskIds.includes(t.taskId))
  }

  const handleTenantScopeChange = (nextScope: string) => {
    setTenantScope(nextScope)
  }

  const tenantOptions = currentUser?.role === 'admin'
    ? [{ value: ALL_TENANTS_SCOPE, label: '全局' }, ...tenants.map((tenant) => ({ value: tenant.slug, label: tenant.display_name }))]
    : [{ value: CURRENT_TENANT_SCOPE, label: activeTenant?.display_name || '当前 tenant' }]

  const handleTenantSnapshotSaved = (snapshot: TenantBudgetSnapshot) => {
    setTenantSnapshots((prev) => ({ ...prev, [snapshot.tenantId]: snapshot }))
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Tenant</span>
              <select
                value={tenantScope}
                onChange={(event) => handleTenantScopeChange(event.target.value)}
                className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground"
              >
                {tenantOptions.map((tenant) => (
                  <option key={tenant.value} value={tenant.value}>{tenant.label}</option>
                ))}
              </select>
            </label>
            {/* View tabs */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(['overview', 'agents', 'sessions', 'tasks', 'controls'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === v ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
            {/* Timeframe */}
            <div className="flex space-x-1">
              {(['hour', 'day', 'week', 'month'] as const).map(tf => (
                <Button key={tf} onClick={() => setTimeframe(tf)} variant={timeframe === tf ? 'default' : 'secondary'} size="sm">
                  {tf.charAt(0).toUpperCase() + tf.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isLoading && !usageStats && view !== 'controls' && tenantScope === ALL_TENANTS_SCOPE ? (
        <Loader variant="panel" label={t('loadingCostData')} />
      ) : view === 'overview' ? (
        tenantScope === ALL_TENANTS_SCOPE ? (
          <div className="space-y-6">
            <GlobalTenantCardsSection
              tenants={tenants}
              snapshots={tenantSnapshots}
              loading={tenantBudgetLoading}
              error={tenantBudgetError}
              onRefresh={loadTenantBudgets}
            />
            <OverviewView
              stats={usageStats} trendData={trendData} agentSummary={agentSummary}
              taskData={taskData} timeframe={timeframe} chartMode={chartMode}
              setChartMode={setChartMode} exportData={exportData} isExporting={isExporting}
              onRefresh={loadData}
            />
          </div>
        ) : (
          <SelectedTenantOverviewView
            snapshot={selectedTenantSnapshot}
            tenantName={selectedTenant?.display_name || tenantScope}
            loading={tenantBudgetLoading}
            error={tenantBudgetError}
            onRefresh={loadTenantBudgets}
          />
        )
      ) : view === 'agents' ? (
        tenantScope === ALL_TENANTS_SCOPE ? (
          <AgentsView
            agents={agentList} summary={agentSummary} maxCost={maxAgentCost}
            expandedAgent={expandedAgent} setExpandedAgent={setExpandedAgent}
            getAgentTasks={getAgentTasks} onRefresh={loadData}
          />
        ) : (
          <TenantAgentBudgetView
            snapshot={selectedTenantSnapshot}
            tenantName={selectedTenant?.display_name || tenantScope}
            loading={tenantBudgetLoading}
            error={tenantBudgetError}
            onRefresh={loadTenantBudgets}
          />
        )
      ) : view === 'sessions' ? (
        tenantScope === ALL_TENANTS_SCOPE ? (
          <SessionsView
            sessionCosts={sessionCosts} sessions={sessions}
            sessionSort={sessionSort} setSessionSort={setSessionSort}
          />
        ) : (
          <TenantScopedUnavailableView tenantName={selectedTenant?.display_name || tenantScope} viewLabel="Sessions" />
        )
      ) : view === 'tasks' ? (
        tenantScope === ALL_TENANTS_SCOPE ? (
          <TasksView taskData={taskData} onRefresh={loadData} />
        ) : (
          <TenantScopedUnavailableView tenantName={selectedTenant?.display_name || tenantScope} viewLabel="Tasks" />
        )
      ) : (
        currentUser?.role === 'admin' && tenantScope === ALL_TENANTS_SCOPE ? (
          <BudgetControlsView
            rules={budgetRules}
            summary={budgetSummary}
            loading={budgetLoading}
            error={budgetError}
            agents={agentList.map(agent => agent.agent)}
            tasks={taskData?.tasks || []}
            onRefresh={loadBudgetRules}
            onSaved={(data) => {
              setBudgetRules(Array.isArray(data.rules) ? data.rules : [])
              setBudgetSummary(data.summary || null)
            }}
          />
        ) : (
          <TenantBudgetControlsView
            snapshot={selectedTenantSnapshot}
            tenantName={selectedTenant?.display_name || tenantScope}
            loading={tenantBudgetLoading}
            error={tenantBudgetError}
            onRefresh={loadTenantBudgets}
            onSaved={handleTenantSnapshotSaved}
          />
        )
      )}
    </div>
  )
}

function TenantScopedUnavailableView({ tenantName, viewLabel }: { tenantName: string; viewLabel: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/70 p-6 text-sm text-muted-foreground">
      <h2 className="text-lg font-semibold text-foreground">{tenantName} · {viewLabel}</h2>
      <p className="mt-2">
        当前 tenant 隔离视图只开放 Overview、Agents 和 预算配置，避免把其他 tenant 的 session / task 成本一起带出来。
      </p>
    </div>
  )
}

function GlobalTenantCardsSection({
  tenants,
  snapshots,
  loading,
  error,
  onRefresh,
}: {
  tenants: Array<{ slug: string; display_name: string; status: string }>
  snapshots: Record<string, TenantBudgetSnapshot>
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
}) {
  if (loading && tenants.length === 0) {
    return <Loader variant="panel" label="Loading tenant budget snapshots" />
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Tenant 预算摘要</h2>
          <p className="text-sm text-muted-foreground mt-1">全局视图保留，同时汇总每个 tenant 的成本、token 和预算状态。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onRefresh().catch(() => {})}>刷新摘要</Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-3 md:grid-cols-2">
        {tenants.map((tenant) => {
          const snapshot = snapshots[tenant.slug]
          return (
            <div key={tenant.slug} className="rounded-lg border border-border bg-card/70 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{tenant.display_name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{tenant.slug}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs ${snapshot ? alertTone(snapshot.alert.status) : 'bg-secondary text-muted-foreground'}`}>
                  {snapshot ? snapshot.alert.label : 'loading'}
                </span>
              </div>

              {!snapshot ? (
                <div className="mt-4 text-sm text-muted-foreground">{loading ? '加载中…' : '暂无预算数据'}</div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">成本</div>
                      <div className="text-lg font-semibold text-foreground">{formatCost(snapshot.usage.totalCostUsd)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Tokens</div>
                      <div className="text-lg font-semibold text-foreground">{formatNumber(snapshot.usage.totalTokens)}</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>预算进度</span>
                      <span>{formatBudgetPercent(snapshot.usage.percentUsed)}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-secondary">
                      <div className={`h-2.5 rounded-full ${alertBarTone(snapshot.alert.status)}`} style={{ width: `${Math.min(snapshot.usage.percentUsed, 100)}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{snapshot.budget.monthlyBudgetUsd > 0 ? formatCost(snapshot.budget.monthlyBudgetUsd) : '未设置'}</span>
                      <span>{snapshot.agents.length} agents</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SelectedTenantOverviewView({
  snapshot,
  tenantName,
  loading,
  error,
  onRefresh,
}: {
  snapshot: TenantBudgetSnapshot | null
  tenantName: string
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
}) {
  if (loading && !snapshot) {
    return <Loader variant="panel" label={`Loading ${tenantName} budget`} />
  }

  if (!snapshot) {
    return (
      <div className="rounded-lg border border-border bg-card/70 p-6 text-sm text-muted-foreground">
        {error || '当前 tenant 暂无预算数据。'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{tenantName} 预算总览</h2>
          <p className="mt-1 text-sm text-muted-foreground">显示该 tenant 的成本、token 量、预算进度和告警状态。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onRefresh().catch(() => {})}>刷新</Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(snapshot.usage.totalCostUsd)}</div>
          <div className="text-sm text-muted-foreground">本月已用</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(snapshot.usage.totalTokens)}</div>
          <div className="text-sm text-muted-foreground">总 Tokens</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{snapshot.budget.monthlyBudgetUsd > 0 ? formatCost(snapshot.budget.monthlyBudgetUsd) : '-'}</div>
          <div className="text-sm text-muted-foreground">月预算</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{snapshot.alert.label}</div>
          <div className="text-sm text-muted-foreground">当前告警</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/70 p-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-lg font-semibold text-foreground">Tenant 预算进度</h3>
          <span className={`rounded-full px-2 py-1 text-xs ${alertTone(snapshot.alert.status)}`}>{formatBudgetPercent(snapshot.usage.percentUsed)}</span>
        </div>
        <div className="h-3 rounded-full bg-secondary">
          <div className={`h-3 rounded-full ${alertBarTone(snapshot.alert.status)}`} style={{ width: `${Math.min(snapshot.usage.percentUsed, 100)}%` }} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3 text-sm text-muted-foreground">
          <div>剩余：<span className="font-medium text-foreground">{snapshot.usage.remainingUsd == null ? '未设置' : formatCost(snapshot.usage.remainingUsd)}</span></div>
          <div>日均速率：<span className="font-medium text-foreground">{formatCost(snapshot.usage.burnRateDailyUsd)}</span></div>
          <div>请求数：<span className="font-medium text-foreground">{formatNumber(snapshot.usage.requestCount)}</span></div>
        </div>
      </div>

      <TenantAgentBudgetView snapshot={snapshot} tenantName={tenantName} loading={false} error={null} onRefresh={onRefresh} />
    </div>
  )
}

function TenantAgentBudgetView({
  snapshot,
  tenantName,
  loading,
  error,
  onRefresh,
}: {
  snapshot: TenantBudgetSnapshot | null
  tenantName: string
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
}) {
  if (loading && !snapshot) {
    return <Loader variant="panel" label={`Loading ${tenantName} agents`} />
  }

  if (!snapshot) {
    return (
      <div className="rounded-lg border border-border bg-card/70 p-6 text-sm text-muted-foreground">
        {error || '暂无 Agent 预算数据。'}
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{tenantName} Per-Agent 预算</h2>
          <p className="mt-1 text-sm text-muted-foreground">每个 Agent 独立展示月预算、进度条、剩余和日均消耗。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onRefresh().catch(() => {})}>刷新</Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      {snapshot.agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">该 tenant 还没有 agent 成本记录。</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {snapshot.agents.map((agent) => (
            <div key={agent.agent} className="rounded-lg border border-border bg-card/70 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{agent.agent}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{formatCost(agent.usedUsd)} 已用 · {formatBudgetPercent(agent.percentUsed)}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs ${alertTone(agent.alert.status)}`}>{agent.alert.label}</span>
              </div>

              <div className="mt-4 h-2.5 rounded-full bg-secondary">
                <div className={`h-2.5 rounded-full ${alertBarTone(agent.alert.status)}`} style={{ width: `${Math.min(agent.percentUsed, 100)}%` }} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">预算</div>
                  <div className="font-medium text-foreground">{agent.budget.monthlyBudgetUsd > 0 ? formatCost(agent.budget.monthlyBudgetUsd) : '未设置'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">剩余</div>
                  <div className="font-medium text-foreground">{agent.remainingUsd == null ? '未设置' : formatCost(agent.remainingUsd)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">日均</div>
                  <div className="font-medium text-foreground">{formatCost(agent.burnRateDailyUsd)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Tokens</div>
                  <div className="font-medium text-foreground">{formatNumber(agent.totalTokens)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function TenantBudgetControlsView({
  snapshot,
  tenantName,
  loading,
  error,
  onRefresh,
}: {
  snapshot: TenantBudgetSnapshot | null
  tenantName: string
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
  onSaved: (snapshot: TenantBudgetSnapshot) => void
}) {
  if (loading && !snapshot) {
    return <Loader variant="panel" label={`Loading ${tenantName} controls`} />
  }

  if (!snapshot) {
    return (
      <div className="rounded-lg border border-border bg-card/70 p-6 text-sm text-muted-foreground">
        {error || '暂无 tenant 预算配置。'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{tenantName} 预算概览</h2>
          <p className="mt-1 text-sm text-muted-foreground">此页面仅供查看。如需修改 Agent 预算，请前往 Agent 设定页的 Budget 页签。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onRefresh().catch(() => {})}>刷新</Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      {snapshot.agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">该 tenant 还没有 agent 成本记录。</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {snapshot.agents.map((agent) => (
            <div key={agent.agent} className="rounded-lg border border-border bg-card/70 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{agent.agent}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{formatCost(agent.usedUsd)} 已用 · {formatBudgetPercent(agent.percentUsed)}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs ${alertTone(agent.alert.status)}`}>{agent.alert.label}</span>
              </div>

              <div className="mt-4 h-2.5 rounded-full bg-secondary">
                <div className={`h-2.5 rounded-full ${alertBarTone(agent.alert.status)}`} style={{ width: `${Math.min(agent.percentUsed, 100)}%` }} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">预算</div>
                  <div className="font-medium text-foreground">{agent.budget.monthlyBudgetUsd > 0 ? formatCost(agent.budget.monthlyBudgetUsd) : '未设置'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">剩余</div>
                  <div className="font-medium text-foreground">{agent.remainingUsd == null ? '未设置' : formatCost(agent.remainingUsd)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">日均</div>
                  <div className="font-medium text-foreground">{formatCost(agent.burnRateDailyUsd)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">动作</div>
                  <div className="font-medium text-foreground">{agent.budget.action}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Overview View ──────────────────────────────────

function OverviewView({
  stats, trendData, agentSummary, taskData, timeframe, chartMode, setChartMode,
  exportData, isExporting, onRefresh,
}: {
  stats: UsageStats | null; trendData: TrendData | null
  agentSummary: ByAgentResponse['summary'] | undefined; taskData: TaskCostsResponse | null
  timeframe: Timeframe; chartMode: 'incremental' | 'cumulative'
  setChartMode: (m: 'incremental' | 'cumulative') => void
  exportData: (f: 'json' | 'csv') => void; isExporting: boolean
  onRefresh: () => void
}) {
  const t = useTranslations('costTracker')
  if (!stats) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noUsageData')}</div>
        <div className="text-sm max-w-sm mx-auto">
          {t('noUsageDataDesc')}
        </div>
        <Button onClick={onRefresh} variant="outline" size="sm" className="mt-4 text-xs">{t('refresh')}</Button>
      </div>
    )
  }

  const modelData = Object.entries(stats.models)
    .map(([model, s]) => ({ name: getModelDisplayName(model), fullName: model, tokens: s.totalTokens, cost: s.totalCost, requests: s.requestCount }))
    .sort((a, b) => b.cost - a.cost)

  const pieData = modelData.slice(0, 6).map(m => ({ name: m.name, value: m.cost }))

  const trendChartData = (() => {
    if (!trendData?.trends) return []
    const raw = trendData.trends.map(t => ({
      time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      tokens: t.tokens, cost: t.cost, requests: t.requests,
    }))
    if (chartMode === 'cumulative') {
      let ct = 0, cc = 0, cr = 0
      return raw.map(d => { ct += d.tokens; cc += d.cost; cr += d.requests; return { ...d, tokens: ct, cost: cc, requests: cr } })
    }
    return raw
  })()

  // Performance metrics
  const models = Object.entries(stats.models)
  const mostEfficient = models.length > 0
    ? models.reduce((best, curr) => {
        const c = curr[1].totalCost / Math.max(1, curr[1].totalTokens)
        const b = best[1].totalCost / Math.max(1, best[1].totalTokens)
        return c < b ? curr : best
      })
    : null
  const efficientCostPerToken = mostEfficient ? mostEfficient[1].totalCost / Math.max(1, mostEfficient[1].totalTokens) : 0
  const potentialSavings = Math.max(0, stats.summary.totalCost - stats.summary.totalTokens * efficientCostPerToken)

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(stats.summary.totalCost)}</div>
          <div className="text-sm text-muted-foreground">{t('totalCost', { timeframe })}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(stats.summary.totalTokens)}</div>
          <div className="text-sm text-muted-foreground">{t('totalTokens')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(stats.summary.requestCount)}</div>
          <div className="text-sm text-muted-foreground">{t('apiRequests')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{agentSummary?.agent_count ?? '-'}</div>
          <div className="text-sm text-muted-foreground">{t('activeAgents')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">
            {taskData ? `${((1 - taskData.unattributed.totalCost / Math.max(stats.summary.totalCost, 0.0001)) * 100).toFixed(0)}%` : '-'}
          </div>
          <div className="text-sm text-muted-foreground">{t('taskAttributed')}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Trend chart */}
        <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">{t('usageTrends')}</h2>
            <div className="flex rounded-md border border-border overflow-hidden">
              {(['incremental', 'cumulative'] as const).map(m => (
                <button key={m} onClick={() => setChartMode(m)}
                  className={`px-2 py-1 text-[10px] font-medium ${chartMode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                >{m === 'incremental' ? t('perTurn') : t('cumulative')}</button>
              ))}
            </div>
          </div>
          <div className="h-64">
            {trendChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noTrendData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" /><YAxis />
                  <Tooltip /><Legend />
                  <Line type="monotone" dataKey="tokens" stroke="#8884d8" strokeWidth={2} name="Tokens" />
                  <Line type="monotone" dataKey="requests" stroke="#82ca9d" strokeWidth={2} name="Requests" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Model bar chart */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('tokenUsageByModel')}</h2>
          <div className="h-64">
            {modelData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noModelData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} />
                  <YAxis /><Tooltip formatter={(v, n) => [formatNumber(Number(v)), n]} />
                  <Bar dataKey="tokens" fill="#8884d8" name="Tokens" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Cost pie */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('costDistributionByModel')}</h2>
          <div className="h-64">
            {pieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noCostData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={80} paddingAngle={5} dataKey="value">
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCost(Number(v))} /><Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Performance insights */}
      {models.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{t('performanceInsights')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">{t('mostEfficientModel')}</div>
              <div className="text-lg font-bold text-green-500">{mostEfficient ? getModelDisplayName(mostEfficient[0]) : '-'}</div>
              {mostEfficient && <div className="text-xs text-muted-foreground">${(efficientCostPerToken * 1000).toFixed(4)}/1K tokens</div>}
            </div>
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">{t('avgTokensPerRequest')}</div>
              <div className="text-lg font-bold text-foreground">{formatNumber(stats.summary.avgTokensPerRequest)}</div>
            </div>
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">{t('optimizationPotential')}</div>
              <div className="text-lg font-bold text-orange-500">{formatCost(potentialSavings)}</div>
              <div className="text-xs text-muted-foreground">{stats.summary.totalCost > 0 ? ((potentialSavings / stats.summary.totalCost) * 100).toFixed(1) : '0'}% {t('savingsPossible')}</div>
            </div>
          </div>
          {/* Model efficiency bars */}
          <div className="space-y-2">
            {modelData.map(m => {
              const costPer1k = m.cost / Math.max(1, m.tokens) * 1000
              const maxCostPer1k = Math.max(...modelData.map(d => d.cost / Math.max(1, d.tokens) * 1000), 0.0001)
              return (
                <div key={m.fullName} className="flex items-center text-sm">
                  <div className="w-32 truncate text-muted-foreground">{m.name}</div>
                  <div className="flex-1 mx-3">
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{ width: `${(costPer1k / maxCostPer1k) * 100}%` }} />
                    </div>
                  </div>
                  <div className="w-20 text-right text-xs text-muted-foreground">${costPer1k.toFixed(4)}/1K</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Export */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t('exportData')}</h2>
            <p className="text-sm text-muted-foreground">{t('exportDataDesc')}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => exportData('csv')} disabled={isExporting} size="sm" variant="secondary">{isExporting ? t('exporting') : 'CSV'}</Button>
            <Button onClick={() => exportData('json')} disabled={isExporting} size="sm" variant="secondary">{isExporting ? t('exporting') : 'JSON'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Agents View ──────────────────────────────────

function AgentsView({
  agents, summary, maxCost, expandedAgent, setExpandedAgent, getAgentTasks, onRefresh,
}: {
  agents: ByAgentEntry[]; summary: ByAgentResponse['summary'] | undefined
  maxCost: number; expandedAgent: string | null
  setExpandedAgent: (a: string | null) => void
  getAgentTasks: (name: string) => TaskCostEntry[]; onRefresh: () => void
}) {
  const t = useTranslations('costTracker')
  const [expandedSection, setExpandedSection] = useState<'models' | 'tasks'>('tasks')

  if (!summary || agents.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noAgentData')}</div>
        <div className="text-sm">{t('noAgentDataDesc')}</div>
        <Button onClick={onRefresh} className="mt-4">{t('refresh')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary.agent_count}</div>
          <div className="text-sm text-muted-foreground">{t('agents')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(summary.total_cost)}</div>
          <div className="text-sm text-muted-foreground">{t('totalCostDays', { days: summary.days })}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(summary.total_tokens)}</div>
          <div className="text-sm text-muted-foreground">{t('totalTokens')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">
            {summary.total_tokens > 0 ? `$${(summary.total_cost / summary.total_tokens * 1000).toFixed(4)}` : '-'}
          </div>
          <div className="text-sm text-muted-foreground">{t('avgPer1kTokens')}</div>
        </div>
      </div>

      {/* Cost bar chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('perAgentCost')}</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agents.slice(0, 12).map(a => ({
              name: a.agent.length > 12 ? a.agent.slice(0, 11) + '\u2026' : a.agent,
              cost: Number(a.total_cost.toFixed(4)),
            }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCost(Number(v))} />
              <Bar dataKey="cost" fill="#0088FE" name="Cost ($)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent detail rows */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('agentBreakdown')}</h2>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {agents.map(agent => {
            const costShare = (agent.total_cost / Math.max(summary.total_cost, 0.0001)) * 100
            const isExpanded = expandedAgent === agent.agent
            const agentTasks = getAgentTasks(agent.agent)
            return (
              <div key={agent.agent} className="border border-border rounded-lg overflow-hidden">
                <Button onClick={() => setExpandedAgent(isExpanded ? null : agent.agent)}
                  variant="ghost" className="w-full p-4 h-auto flex items-center justify-between text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium text-foreground truncate">{agent.agent}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
                      {agent.session_count} session{agent.session_count !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 shrink-0">
                      {agent.request_count} req{agent.request_count !== 1 ? 's' : ''}
                    </span>
                    {agentTasks.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 shrink-0">
                        {agentTasks.length} task{agentTasks.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    <div className="w-24 hidden md:block">
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(agent.total_cost / maxCost) * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-foreground">{formatCost(agent.total_cost)}</div>
                      <div className="text-xs text-muted-foreground">{costShare.toFixed(1)}%</div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground">{formatNumber(agent.total_tokens)}</div>
                      <div className="text-xs text-muted-foreground">{t('tokens')}</div>
                    </div>
                    <svg className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <polyline points="4,6 8,10 12,6" />
                    </svg>
                  </div>
                </Button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border bg-secondary/30">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 mb-3">
                      <div><div className="text-xs text-muted-foreground">{t('inputTokens')}</div><div className="text-sm font-medium">{formatNumber(agent.total_input_tokens)}</div></div>
                      <div><div className="text-xs text-muted-foreground">{t('outputTokens')}</div><div className="text-sm font-medium">{formatNumber(agent.total_output_tokens)}</div></div>
                      <div><div className="text-xs text-muted-foreground">{t('ioRatio')}</div><div className="text-sm font-medium">{agent.total_output_tokens > 0 ? (agent.total_input_tokens / agent.total_output_tokens).toFixed(2) : '-'}</div></div>
                      <div><div className="text-xs text-muted-foreground">{t('lastActive')}</div><div className="text-sm font-medium">{new Date(agent.last_active).toLocaleDateString()}</div></div>
                    </div>

                    <div className="flex gap-2 mb-3">
                      <Button variant={expandedSection === 'tasks' ? 'default' : 'ghost'} size="sm" onClick={(e) => { e.stopPropagation(); setExpandedSection('tasks') }}>Tasks ({agentTasks.length})</Button>
                      <Button variant={expandedSection === 'models' ? 'default' : 'ghost'} size="sm" onClick={(e) => { e.stopPropagation(); setExpandedSection('models') }}>Models ({agent.models.length})</Button>
                    </div>

                    {expandedSection === 'tasks' && (
                      <div className="text-sm">
                        {agentTasks.length === 0 ? (
                          <div className="text-xs text-muted-foreground italic py-2">{t('noTaskCosts')}</div>
                        ) : (
                          <div className="space-y-1.5">
                            {agentTasks.map(task => (
                              <div key={task.taskId} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    task.priority === 'critical' ? 'bg-red-500/10 text-red-500' :
                                    task.priority === 'high' ? 'bg-orange-500/10 text-orange-500' :
                                    task.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                                    'bg-secondary text-muted-foreground'
                                  }`}>{task.priority}</span>
                                  {task.project.ticketRef && <span className="text-muted-foreground font-mono">{task.project.ticketRef}</span>}
                                  <span className="text-foreground truncate">{task.title}</span>
                                </div>
                                <span className="font-medium text-foreground w-16 text-right shrink-0">{formatCost(task.stats.totalCost)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {expandedSection === 'models' && agent.models.length > 0 && (
                      <div className="space-y-1.5">
                        {agent.models.map(m => (
                          <div key={m.model} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground truncate">{getModelDisplayName(m.model)}</span>
                            <div className="flex gap-4 shrink-0">
                              <span>{formatNumber(m.input_tokens)} in</span>
                              <span>{formatNumber(m.output_tokens)} out</span>
                              <span>{m.request_count} reqs</span>
                              <span className="font-medium text-foreground w-16 text-right">{formatCost(m.cost)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Sessions View ──────────────────────────────────

function SessionsView({
  sessionCosts, sessions, sessionSort, setSessionSort,
}: {
  sessionCosts: SessionCostEntry[]; sessions: any[]
  sessionSort: 'cost' | 'tokens' | 'requests' | 'recent'
  setSessionSort: (s: 'cost' | 'tokens' | 'requests' | 'recent') => void
}) {
  const t = useTranslations('costTracker')
  const sorted = [...sessionCosts].sort((a, b) => {
    switch (sessionSort) {
      case 'cost': return b.totalCost - a.totalCost
      case 'tokens': return b.totalTokens - a.totalTokens
      case 'requests': return b.requestCount - a.requestCount
      case 'recent': return (b.lastSeen || '').localeCompare(a.lastSeen || '')
      default: return 0
    }
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{t('sortBy')}:</span>
        {(['cost', 'tokens', 'requests', 'recent'] as const).map(s => (
          <button key={s} onClick={() => setSessionSort(s)}
            className={`px-2 py-1 text-xs rounded ${sessionSort === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
          >{s.charAt(0).toUpperCase() + s.slice(1)}</button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <p className="text-lg mb-1">{t('noSessionCostData')}</p>
          <p className="text-sm">{t('noSessionCostDataDesc')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(entry => {
            const sessionInfo = sessions.find((s: any) => s.id === entry.sessionId)
            return (
              <div key={entry.sessionId} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {entry.sessionKey || sessionInfo?.key || entry.sessionId}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {sessionInfo?.active && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />}
                      <span>{sessionInfo?.active ? t('activeStatus') : t('inactiveStatus')}</span>
                      {entry.model && <span>| {getModelDisplayName(entry.model)}</span>}
                      {sessionInfo?.kind && <span>| {sessionInfo.kind}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold text-foreground">{formatCost(entry.totalCost)}</div>
                    <div className="text-xs text-muted-foreground">{formatNumber(entry.totalTokens)} tokens</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 text-xs text-muted-foreground border-t border-border/50 pt-2 mt-2">
                  <div><span className="font-medium text-foreground">{entry.requestCount}</span> {t('requests')}</div>
                  <div><span className="font-medium text-foreground">{formatNumber(entry.inputTokens || 0)}</span> {t('inShort')}</div>
                  <div><span className="font-medium text-foreground">{formatNumber(entry.outputTokens || 0)}</span> {t('outShort')}</div>
                  <div>{entry.totalTokens > 0 ? <span className="font-medium text-foreground">{formatCost(entry.totalCost / entry.requestCount)}</span> : '-'} {t('avgPerReq')}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Tasks View ──────────────────────────────────

function TasksView({ taskData, onRefresh }: { taskData: TaskCostsResponse | null; onRefresh: () => void }) {
  const t = useTranslations('costTracker')
  if (!taskData || taskData.tasks.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <div className="text-lg mb-2">{t('noTaskCostData')}</div>
        <div className="text-sm">{t('noTaskCostDataDesc')}</div>
        <Button onClick={onRefresh} className="mt-4">{t('refresh')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{taskData.tasks.length}</div>
          <div className="text-sm text-muted-foreground">{t('tasksWithCosts')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatCost(taskData.summary.totalCost)}</div>
          <div className="text-sm text-muted-foreground">{t('attributedCost')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{formatNumber(taskData.summary.totalTokens)}</div>
          <div className="text-sm text-muted-foreground">{t('attributedTokens')}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-orange-500">{formatCost(taskData.unattributed.totalCost)}</div>
          <div className="text-sm text-muted-foreground">{t('unattributed')}</div>
        </div>
      </div>

      {/* Task list */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">{t('tasksByCost')}</h2>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {taskData.tasks.map(task => (
            <div key={task.taskId} className="border border-border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                    task.priority === 'critical' ? 'bg-red-500/10 text-red-500' :
                    task.priority === 'high' ? 'bg-orange-500/10 text-orange-500' :
                    task.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                    'bg-secondary text-muted-foreground'
                  }`}>{task.priority}</span>
                  {task.project.ticketRef && <span className="text-xs text-muted-foreground font-mono shrink-0">{task.project.ticketRef}</span>}
                  <span className="font-medium text-foreground truncate">{task.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${
                    task.status === 'done' ? 'bg-green-500/10 text-green-500' :
                    task.status === 'in_progress' ? 'bg-blue-500/10 text-blue-500' :
                    'bg-secondary text-muted-foreground'
                  }`}>{task.status}</span>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="font-medium text-foreground">{formatCost(task.stats.totalCost)}</div>
                  <div className="text-xs text-muted-foreground">{formatNumber(task.stats.totalTokens)} {t('tokens')} | {task.stats.requestCount} {t('reqs')}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

type BudgetDraft = {
  scope: CostBudgetRule['scope']
  target: string
  category: CostBudgetRule['category']
  timeframe: CostBudgetRule['timeframe']
  limitUsd: string
  maxRequests: string
  maxTokens: string
  action: CostBudgetRule['action']
}

const DEFAULT_BUDGET_DRAFT: BudgetDraft = {
  scope: 'agent',
  target: '',
  category: 'total',
  timeframe: 'day',
  limitUsd: '',
  maxRequests: '',
  maxTokens: '',
  action: 'require_approval',
}

function formatBudgetCaps(rule: CostBudgetRule) {
  return [
    rule.limitUsd ? `${formatCost(rule.limitUsd)} / ${rule.timeframe}` : null,
    rule.maxRequests ? `${rule.maxRequests.toLocaleString()} 次请求` : null,
    rule.maxTokens ? `${formatNumber(rule.maxTokens)} tokens` : null,
  ].filter(Boolean).join(' / ')
}

function actionLabel(action: CostBudgetRule['action']) {
  if (action === 'require_approval') return '需要审批'
  if (action === 'pause') return '暂停执行'
  return '仅提醒'
}

function BudgetControlsView({
  rules, summary, loading, error, agents, tasks, onRefresh, onSaved,
}: {
  rules: CostBudgetRule[]
  summary: CostBudgetSummary | null
  loading: boolean
  error: string | null
  agents: string[]
  tasks: TaskCostEntry[]
  onRefresh: () => void
  onSaved: (data: BudgetRulesResponse) => void
}) {
  const [draft, setDraft] = useState<BudgetDraft>(DEFAULT_BUDGET_DRAFT)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function updateDraft<K extends keyof BudgetDraft>(key: K, value: BudgetDraft[K]) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  async function postBudget(body: Record<string, unknown>) {
    const res = await fetch('/api/tokens/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json() as BudgetRulesResponse
    if (!res.ok) throw new Error(data.error || 'Failed to save budget control')
    onSaved(data)
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setSaveError(null)
    try {
      await postBudget({ rule: draft })
      setDraft(prev => ({ ...DEFAULT_BUDGET_DRAFT, scope: prev.scope, category: prev.category, timeframe: prev.timeframe }))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function toggleRule(rule: CostBudgetRule) {
    setSaving(true)
    setSaveError(null)
    try {
      await postBudget({ rule: { ...rule, enabled: !rule.enabled } })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function deleteRule(rule: CostBudgetRule) {
    setSaving(true)
    setSaveError(null)
    try {
      await postBudget({ action: 'delete', id: rule.id })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const targetListId = draft.scope === 'agent' ? 'cost-budget-agent-targets' : 'cost-budget-task-targets'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary?.enabledRules ?? 0}</div>
          <div className="text-sm text-muted-foreground">已启用上限</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary?.byScope.agent ?? 0}</div>
          <div className="text-sm text-muted-foreground">Agent 上限</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary?.byScope.task ?? 0}</div>
          <div className="text-sm text-muted-foreground">任务上限</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary?.highestLimitUsd ? formatCost(summary.highestLimitUsd) : '-'}</div>
          <div className="text-sm text-muted-foreground">最高美元上限</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="text-3xl font-bold text-foreground">{summary?.blockingRules ?? 0}</div>
          <div className="text-sm text-muted-foreground">审批 / 暂停</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="bg-card border border-border rounded-lg p-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold">预算控制</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              给单个 agent 或单个任务设置 API 调用、大模型调用或合计消耗上限。
            </p>
          </div>

          {(error || saveError) && (
            <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error || saveError}
            </div>
          )}

          <form onSubmit={saveDraft} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                维度
                <select
                  value={draft.scope}
                  onChange={(event) => updateDraft('scope', event.target.value as BudgetDraft['scope'])}
                  className="h-9 w-full min-w-0 rounded border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="agent">Agent</option>
                  <option value="task">任务</option>
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                对象
                <input
                  value={draft.target}
                  onChange={(event) => updateDraft('target', event.target.value)}
                  list={targetListId}
                  placeholder={draft.scope === 'agent' ? 'agent name' : 'task id'}
                  className="h-9 w-full min-w-0 rounded border border-border bg-background px-3 text-sm text-foreground"
                />
              </label>
            </div>

            <datalist id="cost-budget-agent-targets">
              {agents.map(agent => <option key={agent} value={agent} />)}
            </datalist>
            <datalist id="cost-budget-task-targets">
              {tasks.map(task => <option key={task.taskId} value={String(task.taskId)} label={task.title} />)}
            </datalist>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                成本类型
                <select
                  value={draft.category}
                  onChange={(event) => updateDraft('category', event.target.value as BudgetDraft['category'])}
                  className="h-9 w-full min-w-0 rounded border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="total">API + LLM</option>
                  <option value="api">API 调用</option>
                  <option value="llm">大模型调用</option>
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                周期
                <select
                  value={draft.timeframe}
                  onChange={(event) => updateDraft('timeframe', event.target.value as BudgetDraft['timeframe'])}
                  className="h-9 w-full min-w-0 rounded border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="day">天</option>
                  <option value="week">周</option>
                  <option value="month">月</option>
                  <option value="run">单次任务</option>
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                超限动作
                <select
                  value={draft.action}
                  onChange={(event) => updateDraft('action', event.target.value as BudgetDraft['action'])}
                  className="h-9 w-full min-w-0 rounded border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="warn">仅提醒</option>
                  <option value="require_approval">需要审批</option>
                  <option value="pause">暂停执行</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                美元上限
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.limitUsd}
                  onChange={(event) => updateDraft('limitUsd', event.target.value)}
                  placeholder="10.00"
                  className="h-9 w-full min-w-0 rounded border border-border bg-background px-3 text-sm text-foreground"
                />
              </label>
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                请求数上限
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.maxRequests}
                  onChange={(event) => updateDraft('maxRequests', event.target.value)}
                  placeholder="500"
                  className="h-9 w-full min-w-0 rounded border border-border bg-background px-3 text-sm text-foreground"
                />
              </label>
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                Token 上限
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.maxTokens}
                  onChange={(event) => updateDraft('maxTokens', event.target.value)}
                  placeholder="200000"
                  className="h-9 w-full min-w-0 rounded border border-border bg-background px-3 text-sm text-foreground"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" size="sm" disabled={saving}>{saving ? '保存中...' : '保存上限'}</Button>
              <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading || saving}>
                {loading ? '刷新中...' : '刷新'}
              </Button>
            </div>
          </form>
        </section>

        <section className="bg-card border border-border rounded-lg p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">已配置上限</h2>
              <p className="mt-1 text-sm text-muted-foreground">这里是运行配置控制，不是测试专用的成本报表。</p>
            </div>
            <span className="rounded bg-secondary px-2 py-1 text-xs text-muted-foreground">{rules.length} 条</span>
          </div>

          {rules.length === 0 ? (
            <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              暂无预算上限配置。
            </div>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto">
              {rules.map(rule => (
                <div key={rule.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${rule.enabled ? 'bg-green-500/10 text-green-500' : 'bg-secondary text-muted-foreground'}`}>
                          {rule.enabled ? '已启用' : '已停用'}
                        </span>
                        <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{rule.scope}</span>
                        <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{rule.category}</span>
                      </div>
                      <div className="mt-2 truncate text-base font-medium text-foreground">{rule.target}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{formatBudgetCaps(rule) || 'No caps'}</div>
                      <div className="mt-1 text-xs text-muted-foreground">超限后：{actionLabel(rule.action)}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => toggleRule(rule)} disabled={saving}>
                        {rule.enabled ? '停用' : '启用'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => deleteRule(rule)} disabled={saving}>
                        移除
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
