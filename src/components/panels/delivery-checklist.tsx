'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useNavigateToPanel } from '@/lib/navigation'

type CheckStatus = 'pass' | 'warn' | 'fail' | 'not_run'
type OverallStatus = 'ready' | 'warning' | 'blocked' | 'not_run'

interface ReadyToShipCheck {
  check_id: string
  check_name: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  check_method: 'api_call' | 'log_scan' | 'test_run'
  expected: string
  fail_hint: string
  blocker_for_ship?: boolean
  status: CheckStatus
  summary: string
  detail: string
  action_panel: 'boundary' | 'tests' | 'delivery' | 'alerts' | 'channels'
  metric?: {
    passed?: number
    total?: number
    rate?: number
  }
}

interface ReadyToShipReport {
  tenant: string
  tenants: string[]
  profile: 'strict' | 'green'
  generated_at: string
  rules_version: string
  rules_path: string
  overall_status: OverallStatus
  ready_to_ship: boolean
  summary: Record<CheckStatus, number> & { total: number }
  test_summary: {
    passed: number
    total: number
    pass_rate: number
    suites: Array<{ id: string; label: string; passed: number; total: number; path: string }>
  }
  agent_summary: {
    soul_present: boolean
    soul_lines: number
    agents_present: boolean
    agents_lines: number
    skill_count: number
    skills: string[]
    boundary_forbidden_count: number
    boundary_drift_count: number
  }
  checks: ReadyToShipCheck[]
  error?: string
}

interface ToastState {
  title: string
  detail: string
  kind: 'success' | 'error' | 'info'
}

const statusMeta: Record<CheckStatus, { label: string; icon: string; className: string; badgeClassName: string }> = {
  pass: {
    label: '通过',
    icon: '🟢',
    className: 'text-emerald-300',
    badgeClassName: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  },
  warn: {
    label: '警告',
    icon: '🟡',
    className: 'text-amber-300',
    badgeClassName: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  },
  fail: {
    label: '失败',
    icon: '🔴',
    className: 'text-red-300',
    badgeClassName: 'border-red-500/30 bg-red-500/10 text-red-200',
  },
  not_run: {
    label: '未跑',
    icon: '⚪',
    className: 'text-muted-foreground',
    badgeClassName: 'border-border bg-secondary/40 text-muted-foreground',
  },
}

const overallMeta: Record<OverallStatus, { label: string; className: string }> = {
  ready: { label: '🟢 Ready to Ship', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' },
  warning: { label: '🟡 Needs Review', className: 'border-amber-500/30 bg-amber-500/10 text-amber-200' },
  blocked: { label: '🔴 Blocked', className: 'border-red-500/30 bg-red-500/10 text-red-200' },
  not_run: { label: '⚪ Not Run', className: 'border-border bg-secondary/40 text-muted-foreground' },
}

const panelClassName = 'rounded-lg border border-border bg-card/70'
const inputClassName = 'h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10'
const statusOrder: CheckStatus[] = ['pass', 'warn', 'fail', 'not_run']
const actionPanelLabels: Record<ReadyToShipCheck['action_panel'], string> = {
  boundary: 'Boundary',
  tests: 'Tests',
  delivery: 'Delivery',
  alerts: 'Alerts',
  channels: 'Channels',
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error')
}

function makeQuery(tenant: string, profile: 'strict' | 'green') {
  const params = new URLSearchParams({ tenant })
  if (profile === 'green') params.set('profile', 'green')
  return params.toString()
}

function readProfileFromLocation(): 'strict' | 'green' {
  if (typeof window === 'undefined') return 'strict'
  const value = new URLSearchParams(window.location.search).get('rts')
  return value === 'green' || value === 'all-green' ? 'green' : 'strict'
}

function StatusLights({ status }: { status: CheckStatus }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`status ${status}`}>
      {statusOrder.map(item => (
        <span key={item} className={status === item ? statusMeta[item].className : 'grayscale opacity-40'} title={statusMeta[item].label}>
          {status === item ? statusMeta[item].icon : '⚪'}
        </span>
      ))}
    </div>
  )
}

export function DeliveryChecklistPanel() {
  const navigateToPanel = useNavigateToPanel()
  const [tenant, setTenant] = useState('media-intel-v1')
  const [availableTenants, setAvailableTenants] = useState(['media-intel-v1', 'ceo-assistant-v1', 'web3-research-v1'])
  const [profile, setProfile] = useState<'strict' | 'green'>('strict')
  const [report, setReport] = useState<ReadyToShipReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState | null>(null)

  useEffect(() => {
    setProfile(readProfileFromLocation())
  }, [])

  const readyBadge = report ? overallMeta[report.overall_status] : overallMeta.not_run
  const criticalIssues = useMemo(() => report?.checks.filter(check => (
    check.status === 'fail' && (check.severity === 'critical' || check.severity === 'high')
  )) || [], [report])

  const runChecks = useCallback(async (nextTenant = tenant, nextProfile = profile) => {
    setLoading(true)
    setError(null)
    setToast(null)
    try {
      const response = await fetch(`/api/harness/ready-to-ship?${makeQuery(nextTenant, nextProfile)}`, { cache: 'no-store' })
      const body = await response.json() as ReadyToShipReport
      if (!response.ok) throw new Error(body.error || 'Failed to run ready-to-ship checks')
      setReport(body)
      setAvailableTenants(body.tenants?.length ? body.tenants : ['media-intel-v1', 'ceo-assistant-v1', 'web3-research-v1'])
      const firstProblem = body.checks.find(check => check.status === 'fail' || check.status === 'warn')
      setExpanded(firstProblem ? new Set([firstProblem.check_id]) : new Set())
    } catch (nextError) {
      setError(getErrorMessage(nextError))
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [profile, tenant])

  useEffect(() => {
    runChecks().catch(() => {})
  }, [runChecks])

  const exportPdf = useCallback(async () => {
    setExporting(true)
    setToast(null)
    try {
      const response = await fetch(`/api/harness/checklist-pdf?${makeQuery(tenant, profile)}`)
      if (!response.ok) throw new Error(await response.text())
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `checklist-${tenant}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setToast({ kind: 'success', title: 'PDF 已导出', detail: `checklist-${tenant}.pdf` })
    } catch (nextError) {
      setToast({ kind: 'error', title: 'PDF 导出失败', detail: getErrorMessage(nextError) })
    } finally {
      setExporting(false)
    }
  }, [profile, tenant])

  const toggleExpanded = (id: string) => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="relative flex h-full flex-col gap-4 px-1 pb-6">
      <div className={`${panelClassName} flex flex-col gap-4 p-5 xl:flex-row xl:items-start xl:justify-between`}>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground">Delivery Checklist</h1>
            <span className={`rounded-md border px-2.5 py-1 text-sm font-medium ${readyBadge.className}`}>
              {readyBadge.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border px-2.5 py-1">Rules: v{report?.rules_version || '-'}</span>
            <span className="rounded-md border border-border px-2.5 py-1">Tenant: {tenant}</span>
            <span className="rounded-md border border-border px-2.5 py-1">Mode: {profile === 'green' ? 'all-green preview' : 'strict'}</span>
            <span className="rounded-md border border-border px-2.5 py-1">Updated: {report ? new Date(report.generated_at).toLocaleTimeString() : '-'}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1.5">
            <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Tenant template</span>
            <select
              className={inputClassName}
              value={tenant}
              onChange={(event) => {
                setTenant(event.target.value)
                runChecks(event.target.value, profile).catch(() => {})
              }}
              disabled={loading}
            >
              {availableTenants.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <Button variant="ghost" onClick={() => runChecks()} disabled={loading}>
            {loading ? 'Running...' : 'Run Checks'}
          </Button>
          <Button onClick={exportPdf} disabled={exporting || loading || !report}>
            {exporting ? 'Exporting...' : 'Export checklist.pdf'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {report && (
        <div className="grid gap-3 md:grid-cols-4">
          <SummaryTile label="Checks passed" value={`${report.summary.pass}/${report.summary.total}`} tone="emerald" />
          <SummaryTile label="Warnings" value={String(report.summary.warn)} tone="amber" />
          <SummaryTile label="Failures" value={String(report.summary.fail)} tone="red" />
          <SummaryTile label="Test pass rate" value={`${report.test_summary.pass_rate}%`} tone="cyan" />
        </div>
      )}

      {report && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className={`${panelClassName} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Ready-to-Ship Checks</h2>
                <p className="text-xs text-muted-foreground">10 checks from ready-to-ship-rules.json v{report.rules_version}</p>
              </div>
              {criticalIssues.length > 0 && (
                <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs text-red-200">
                  {criticalIssues.length} blocker{criticalIssues.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            <div className="divide-y divide-border">
              {report.checks.map(check => {
                const isExpanded = expanded.has(check.check_id)
                return (
                  <div key={check.check_id} className="bg-card/30">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(check.check_id)}
                      className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition hover:bg-secondary/25"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{check.check_id}</span>
                          <span className="text-sm font-semibold text-foreground">{check.check_name}</span>
                          <span className="rounded border border-border px-1.5 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
                            {check.severity}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{check.summary}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <StatusLights status={check.status} />
                        <span className={`rounded-md border px-2.5 py-1 text-xs ${statusMeta[check.status].badgeClassName}`}>
                          {statusMeta[check.status].label}
                        </span>
                        <span className="text-xs text-muted-foreground">{isExpanded ? 'Collapse' : 'Expand'}</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="space-y-3 border-t border-border bg-background/35 px-4 py-4">
                        <div className="grid gap-3 lg:grid-cols-2">
                          <InfoBlock label="Expected" value={check.expected} />
                          <InfoBlock label="Evidence" value={check.detail} />
                        </div>
                        {(check.status === 'fail' || check.status === 'warn') && (
                          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-3">
                            <div className="text-xs font-medium uppercase tracking-wide text-amber-200">Fail hint</div>
                            <p className="mt-1 text-sm text-amber-100">{check.fail_hint}</p>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {check.action_panel !== 'delivery' && (
                            <Button variant="ghost" size="sm" onClick={() => navigateToPanel(check.action_panel)}>
                              Jump to {actionPanelLabels[check.action_panel]}
                            </Button>
                          )}
                          {check.metric && (
                            <span className="text-xs text-muted-foreground">
                              Metric: {check.metric.passed}/{check.metric.total} ({check.metric.rate}%)
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <aside className="space-y-4">
            <section className={`${panelClassName} p-4`}>
              <h2 className="text-sm font-semibold text-foreground">Test Summary</h2>
              <div className="mt-3 space-y-3">
                {report.test_summary.suites.map(suite => (
                  <div key={suite.id}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{suite.label}</span>
                      <span className="text-muted-foreground">{suite.passed}/{suite.total}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(100, Math.round((suite.passed / suite.total) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={`${panelClassName} p-4`}>
              <h2 className="text-sm font-semibold text-foreground">Agent Config Summary</h2>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <ConfigStat label="SOUL lines" value={report.agent_summary.soul_lines} />
                <ConfigStat label="AGENTS lines" value={report.agent_summary.agents_lines} />
                <ConfigStat label="Skills" value={report.agent_summary.skill_count} />
                <ConfigStat label="Boundary rules" value={`${report.agent_summary.boundary_forbidden_count}/${report.agent_summary.boundary_drift_count}`} />
              </dl>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {report.agent_summary.skills.map(skill => (
                  <span key={skill} className="rounded-md border border-border bg-background px-2 py-1 text-2xs text-muted-foreground">
                    {skill}
                  </span>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}

      {loading && !report && (
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm text-muted-foreground">Running ready-to-ship checks...</div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 w-[320px] rounded-lg border px-4 py-3 shadow-xl ${
          toast.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100' :
            toast.kind === 'error' ? 'border-red-500/30 bg-red-500/15 text-red-100' :
              'border-border bg-card text-foreground'
        }`}>
          <div className="text-sm font-semibold">{toast.title}</div>
          <div className="mt-1 text-xs opacity-80">{toast.detail}</div>
        </div>
      )}
    </div>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'red' | 'cyan' }) {
  const toneClass = {
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
    red: 'border-red-500/25 bg-red-500/10 text-red-200',
    cyan: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200',
  }[tone]
  return (
    <div className={`${panelClassName} p-4`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-2 inline-flex rounded-md border px-2.5 py-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  )
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  )
}

function ConfigStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background/70 px-3 py-2">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  )
}
