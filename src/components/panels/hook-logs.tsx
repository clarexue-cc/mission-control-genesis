'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type HookDirection = 'input' | 'output'
type HookAction = 'block' | 'warn' | 'append_disclaimer' | 'pass'
type HookSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
type HookTab = 'input' | 'output' | 'all'

interface HookLogEvent {
  id: string
  timestamp: string
  direction: HookDirection
  tenant: string
  agent: string
  skill: string
  content_preview: string
  content_full: string
  rule_matched: string | null
  action: HookAction
  severity: HookSeverity
  user_id?: string
  session_id?: string
  correlation_id?: string
  latency_ms?: number
  response_template_used?: string | null
  source_file: string
  line_number: number
}

interface HookLogsResponse {
  events: HookLogEvent[]
  pagination: {
    page: number
    per_page: number
    total: number
    total_pages: number
  }
  facets: {
    tenants: string[]
    agents: string[]
    skills: string[]
    directions: string[]
    actions: string[]
    severities: string[]
    rules: string[]
  }
  source: {
    phase0_dir: string | null
    files: string[]
    available: boolean
  }
  error?: string
}

interface HookFilters {
  tenant: string
  agents: string[]
  skills: string[]
  direction: 'all' | HookDirection
  actions: string[]
  severities: string[]
  timeRange: string
  rule: string
}

const tabConfig: Record<HookTab, { label: string; direction: 'all' | HookDirection; actions: string[] }> = {
  input: { label: '输入拦截', direction: 'input', actions: ['block', 'warn'] },
  output: { label: '输出拦截', direction: 'output', actions: ['block', 'warn', 'append_disclaimer'] },
  all: { label: '全部日志', direction: 'all', actions: [] },
}

const actionLabels: Record<string, string> = {
  block: '拦截',
  warn: '警告',
  append_disclaimer: '加免责',
  pass: '通过',
}

const severityIcons: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: '⚪',
}

const severityLabels: Record<string, string> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
}

const directionLabels: Record<string, string> = {
  all: '全部',
  input: '输入',
  output: '输出',
}

const directionArrows: Record<string, string> = {
  input: '→',
  output: '←',
}

const timeRanges = [
  ['last_1h', '最近 1h'],
  ['last_6h', '最近 6h'],
  ['last_24h', '最近 24h'],
  ['last_7d', '最近 7d'],
  ['all', '全部时间'],
]

const inputClassName = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10'
const filterBlockClassName = 'rounded-lg border border-border bg-card/60 p-3'

function truncate(value: string, max: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function timeRel(timestamp: string) {
  const diff = Date.now() - Date.parse(timestamp)
  if (!Number.isFinite(diff)) return timestamp
  if (diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

function fieldValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function buildQuery(filters: HookFilters, page: number) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('per_page', '50')
  params.set('time_range', filters.timeRange)
  if (filters.tenant !== 'all') params.set('tenant', filters.tenant)
  if (filters.agents.length) params.set('agent', filters.agents.join(','))
  if (filters.skills.length) params.set('skill', filters.skills.join(','))
  if (filters.direction !== 'all') params.set('direction', filters.direction)
  if (filters.actions.length) params.set('action', filters.actions.join(','))
  if (filters.severities.length) params.set('severity', filters.severities.join(','))
  if (filters.rule.trim()) params.set('rule', filters.rule.trim())
  return params
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value]
}

function EventListItem({ event, selected, onClick }: {
  event: HookLogEvent
  selected: boolean
  onClick: () => void
}) {
  const listText = `${severityIcons[event.severity] || '⚪'} ${timeRel(event.timestamp)} · ${directionArrows[event.direction] || '→'} ${event.agent} · ${actionLabels[event.action] || event.action} · ${event.rule_matched || '—'} · ${truncate(event.content_preview || event.content_full, 60)}`
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
        selected
          ? 'border-primary/60 bg-primary/10 text-foreground'
          : 'border-border bg-background/60 text-muted-foreground hover:border-border/80 hover:bg-secondary/60 hover:text-foreground'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{listText}</span>
        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          {event.tenant}
        </span>
      </div>
    </button>
  )
}

function FilterCheckboxGroup({ label, options, values, onToggle, emptyLabel }: {
  label: string
  options: string[]
  values: string[]
  onToggle: (value: string) => void
  emptyLabel?: string
}) {
  return (
    <div className={filterBlockClassName}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.length === 0 && <span className="text-xs text-muted-foreground">{emptyLabel || '—'}</span>}
        {options.map(option => (
          <button
            key={option}
            type="button"
            onClick={() => onToggle(option)}
            className={`rounded-md border px-2 py-1 text-xs transition ${
              values.includes(option)
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            {actionLabels[option] || severityLabels[option] || option}
          </button>
        ))}
      </div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm text-foreground">{fieldValue(value)}</div>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-background/60 p-3">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

export function HookLogsPanel() {
  const [activeTab, setActiveTab] = useState<HookTab>('input')
  const [filters, setFilters] = useState<HookFilters>({
    tenant: 'all',
    agents: [],
    skills: [],
    direction: 'input',
    actions: ['block', 'warn'],
    severities: ['critical', 'high', 'medium'],
    timeRange: 'last_1h',
    rule: '',
  })
  const [page, setPage] = useState(1)
  const [data, setData] = useState<HookLogsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pairEvents, setPairEvents] = useState<HookLogEvent[]>([])
  const [actionInfo, setActionInfo] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const events = data?.events || []
  const selectedEvent = useMemo(
    () => events.find(event => event.id === selectedId) || events[0] || null,
    [events, selectedId],
  )

  const loadEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    const query = buildQuery(filters, page)
    try {
      const response = await fetch(`/api/harness/hook-logs?${query.toString()}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'Failed to load hook logs')
      setData(body)
      setSelectedId((current) => {
        if (current && body.events?.some((event: HookLogEvent) => event.id === current)) return current
        return body.events?.[0]?.id || null
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load hook logs')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => {
    loadEvents().catch(() => {})
  }, [loadEvents])

  const applyTab = useCallback((tab: HookTab) => {
    setActiveTab(tab)
    const config = tabConfig[tab]
    setFilters(current => ({
      ...current,
      direction: config.direction,
      actions: config.actions,
      severities: tab === 'all' ? [] : current.severities.length ? current.severities : ['critical', 'high', 'medium'],
    }))
    setPairEvents([])
    setPage(1)
  }, [])

  const updateFilters = useCallback((update: (current: HookFilters) => HookFilters) => {
    setFilters(update)
    setPairEvents([])
    setPage(1)
  }, [])

  const viewPairEvents = useCallback(async (event: HookLogEvent) => {
    if (!event.correlation_id) return
    setActionInfo(null)
    setActionError(null)
    const params = new URLSearchParams({
      correlation_id: event.correlation_id,
      time_range: 'all',
      per_page: '20',
    })
    try {
      const response = await fetch(`/api/harness/hook-logs?${params.toString()}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'Failed to load paired events')
      setPairEvents((body.events || []).filter((item: HookLogEvent) => item.id !== event.id))
      setActionInfo(`配对事件：${Math.max((body.events || []).length - 1, 0)}`)
    } catch (loadError) {
      setActionError(loadError instanceof Error ? loadError.message : 'Failed to load paired events')
    }
  }, [])

  const markFalsePositive = useCallback(async (event: HookLogEvent) => {
    if (event.action === 'pass') return
    const confirmed = window.confirm(`确认将 ${event.rule_matched || '—'} 标为误拦截？`)
    if (!confirmed) return
    setActionInfo(null)
    setActionError(null)
    try {
      const response = await fetch('/api/harness/hook-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_false_positive', event }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'Failed to mark false positive')
      setActionInfo('已写入 mistakes.md')
    } catch (markError) {
      setActionError(markError instanceof Error ? markError.message : 'Failed to mark false positive')
    }
  }, [])

  const jumpToRule = useCallback((event: HookLogEvent) => {
    if (!event.rule_matched) return
    window.location.href = `/panels/boundary#${encodeURIComponent(event.rule_matched)}`
  }, [])

  const tabCounts = useMemo(() => {
    const all = data?.pagination.total || 0
    return {
      input: activeTab === 'input' ? all : null,
      output: activeTab === 'output' ? all : null,
      all: activeTab === 'all' ? all : null,
    }
  }, [activeTab, data?.pagination.total])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/70 p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Hook Logs</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border px-2.5 py-1">events: {data?.pagination.total || 0}</span>
            <span className="rounded-md border border-border px-2.5 py-1">files: {data?.source.files.length || 0}</span>
            <span className="rounded-md border border-border px-2.5 py-1">source: {data?.source.phase0_dir || 'unavailable'}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="ghost" onClick={() => loadEvents()} disabled={loading}>
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setFilters({
                tenant: 'all',
                agents: [],
                skills: [],
                direction: tabConfig[activeTab].direction,
                actions: tabConfig[activeTab].actions,
                severities: activeTab === 'all' ? [] : ['critical', 'high', 'medium'],
                timeRange: 'last_1h',
                rule: '',
              })
              setPage(1)
            }}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(tabConfig) as HookTab[]).map(tab => (
          <Button
            key={tab}
            variant={activeTab === tab ? 'default' : 'outline'}
            onClick={() => applyTab(tab)}
            className="min-w-[120px]"
          >
            {tabConfig[tab].label}
            {tabCounts[tab] !== null && <span className="ml-1 text-xs opacity-80">{tabCounts[tab]}</span>}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        <label className={filterBlockClassName}>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tenant</span>
          <select
            className={inputClassName}
            value={filters.tenant}
            onChange={(event) => updateFilters(current => ({ ...current, tenant: event.target.value }))}
          >
            <option value="all">all</option>
            {(data?.facets.tenants || []).map(tenant => <option key={tenant} value={tenant}>{tenant}</option>)}
          </select>
        </label>

        <label className={filterBlockClassName}>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">时间范围</span>
          <select
            className={inputClassName}
            value={filters.timeRange}
            onChange={(event) => updateFilters(current => ({ ...current, timeRange: event.target.value }))}
          >
            {timeRanges.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <label className={filterBlockClassName}>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">规则 ID</span>
          <input
            className={inputClassName}
            value={filters.rule}
            placeholder="INV-001"
            onChange={(event) => updateFilters(current => ({ ...current, rule: event.target.value }))}
          />
        </label>

        <div className={filterBlockClassName}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">方向</div>
          <div className="grid grid-cols-3 gap-1.5">
            {(['all', 'input', 'output'] as Array<'all' | HookDirection>).map(direction => (
              <button
                key={direction}
                type="button"
                onClick={() => updateFilters(current => ({ ...current, direction }))}
                className={`rounded-md border px-2 py-1.5 text-xs transition ${
                  filters.direction === direction
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {directionLabels[direction]}
              </button>
            ))}
          </div>
        </div>

        <FilterCheckboxGroup
          label="Agent"
          options={data?.facets.agents || []}
          values={filters.agents}
          onToggle={(value) => updateFilters(current => ({ ...current, agents: toggleValue(current.agents, value) }))}
        />
        <FilterCheckboxGroup
          label="Skill"
          options={data?.facets.skills || []}
          values={filters.skills}
          onToggle={(value) => updateFilters(current => ({ ...current, skills: toggleValue(current.skills, value) }))}
        />
        <FilterCheckboxGroup
          label="Hook 动作"
          options={data?.facets.actions || ['block', 'warn', 'append_disclaimer', 'pass']}
          values={filters.actions}
          onToggle={(value) => updateFilters(current => ({ ...current, actions: toggleValue(current.actions, value) }))}
        />
        <FilterCheckboxGroup
          label="严重程度"
          options={data?.facets.severities || ['critical', 'high', 'medium', 'low', 'info']}
          values={filters.severities}
          onToggle={(value) => updateFilters(current => ({ ...current, severities: toggleValue(current.severities, value) }))}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {actionError}
        </div>
      )}

      {actionInfo && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {actionInfo}
        </div>
      )}

      <div className="grid min-h-[62vh] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.82fr)]">
        <section className="rounded-lg border border-border bg-card/70 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Events</h2>
            <span className="text-xs text-muted-foreground">
              {loading ? 'Loading' : `${events.length} / ${data?.pagination.total || 0}`}
            </span>
          </div>

          <div className="space-y-2">
            {!loading && events.length === 0 && (
              <div className="rounded-lg border border-border bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
                No hook events match the current filters.
              </div>
            )}
            {loading && (
              <div className="rounded-lg border border-border bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
                Loading hook events…
              </div>
            )}
            {events.map(event => (
              <EventListItem
                key={event.id}
                event={event}
                selected={selectedEvent?.id === event.id}
                onClick={() => {
                  setSelectedId(event.id)
                  setPairEvents([])
                  setActionInfo(null)
                  setActionError(null)
                }}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(current => Math.max(1, current - 1))}
            >
              Prev
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {data?.pagination.page || page} / {Math.max(data?.pagination.total_pages || 1, 1)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!data || page >= data.pagination.total_pages}
              onClick={() => setPage(current => current + 1)}
            >
              Next
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card/70 p-3 shadow-sm">
          {!selectedEvent && (
            <div className="flex min-h-[42vh] items-center justify-center text-sm text-muted-foreground">
              Select an event.
            </div>
          )}

          {selectedEvent && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {severityIcons[selectedEvent.severity] || '⚪'} {actionLabels[selectedEvent.action] || selectedEvent.action} · {selectedEvent.rule_matched || '—'}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedEvent.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={!selectedEvent.rule_matched} onClick={() => jumpToRule(selectedEvent)}>
                    看规则原文
                  </Button>
                  <Button variant="outline" size="sm" disabled={!selectedEvent.correlation_id} onClick={() => viewPairEvents(selectedEvent)}>
                    看配对事件
                  </Button>
                  <Button variant="destructive" size="sm" disabled={selectedEvent.action === 'pass'} onClick={() => markFalsePositive(selectedEvent)}>
                    标为误拦截
                  </Button>
                </div>
              </div>

              <DetailSection title="基本">
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailField label="timestamp" value={selectedEvent.timestamp} />
                  <DetailField label="tenant" value={selectedEvent.tenant} />
                  <DetailField label="agent" value={selectedEvent.agent} />
                  <DetailField label="skill" value={selectedEvent.skill} />
                  <DetailField label="direction" value={selectedEvent.direction} />
                </div>
              </DetailSection>

              <DetailSection title="原始内容">
                <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-black/20 p-3 text-xs leading-relaxed text-foreground">
                  {selectedEvent.content_full || selectedEvent.content_preview || '—'}
                </pre>
              </DetailSection>

              <DetailSection title="Hook 判定">
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailField label="rule_matched" value={selectedEvent.rule_matched} />
                  <DetailField label="action" value={actionLabels[selectedEvent.action] || selectedEvent.action} />
                  <DetailField label="severity" value={selectedEvent.severity} />
                  <DetailField label="response_template_used" value={selectedEvent.response_template_used} />
                </div>
              </DetailSection>

              <DetailSection title="元数据">
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailField label="user_id" value={selectedEvent.user_id} />
                  <DetailField label="session_id" value={selectedEvent.session_id} />
                  <DetailField label="correlation_id" value={selectedEvent.correlation_id} />
                  <DetailField label="latency_ms" value={selectedEvent.latency_ms} />
                  <DetailField label="source_file" value={selectedEvent.source_file} />
                  <DetailField label="line_number" value={selectedEvent.line_number} />
                </div>
              </DetailSection>

              {pairEvents.length > 0 && (
                <DetailSection title="配对事件">
                  <div className="space-y-2">
                    {pairEvents.map(event => (
                      <EventListItem
                        key={event.id}
                        event={event}
                        selected={false}
                        onClick={() => {
                          setSelectedId(event.id)
                          setPairEvents([])
                        }}
                      />
                    ))}
                  </div>
                </DetailSection>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
