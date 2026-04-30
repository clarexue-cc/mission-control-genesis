'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

type HealthStatus = 'ready' | 'warning' | 'blocked'
type CheckStatus = 'pass' | 'warn' | 'fail'

interface HarnessHealthCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  action?: string
}

interface HarnessHealthSuite {
  id: string
  label: string
  expected: number
  actual: number
  status: CheckStatus
  file: string
}

interface HarnessRuntimeContainer {
  name: string
  status: CheckStatus
  detail: string
  running: boolean
  health: string | null
}

interface HarnessHealth {
  status: HealthStatus
  tenant: string
  template: string | null
  total_cases: number
  harness_root: string | null
  runner_path: string | null
  runtime_target: string
  container: HarnessRuntimeContainer | null
  suites: HarnessHealthSuite[]
  checks: HarnessHealthCheck[]
  latest_report?: {
    path: string
    updated_at: string
  } | null
}

function healthClassName(status: HealthStatus | CheckStatus) {
  if (status === 'ready' || status === 'pass') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (status === 'warning' || status === 'warn') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  return 'border-red-500/30 bg-red-500/10 text-red-300'
}

function formatReportTime(value?: string) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

export function HarnessPanel() {
  const [health, setHealth] = useState<HarnessHealth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchHealth = useCallback(async () => {
    setRefreshing(true)
    try {
      const params = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
      const tenant = params?.get('tenant') || params?.get('tenant_id') || resolveDefaultCustomerTenantId()
      const response = await fetch(`/api/harness/health?tenant=${encodeURIComponent(tenant)}`)
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      setHealth(body as HarnessHealth)
      setError(null)
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load harness health')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchHealth()
    const timer = setInterval(() => {
      void fetchHealth()
    }, 15000)
    return () => clearInterval(timer)
  }, [fetchHealth])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <div className="rounded-lg border border-border bg-card/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Harness Operations</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Harness owns runner readiness, test inventory, reports, and runtime target checks.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {health && (
              <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${healthClassName(health.status)}`}>
                {health.status}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={fetchHealth} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>

      {!health ? (
        <section className="rounded-lg border border-border bg-card/70 p-5 text-sm text-muted-foreground shadow-sm">
          Loading harness operations...
        </section>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tenant</div>
              <div className="mt-2 truncate font-mono text-sm text-foreground" title={health.tenant}>{health.tenant}</div>
              <div className="mt-2 text-xs text-muted-foreground">template={health.template || '-'}</div>
            </div>
            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cases</div>
              <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">{health.total_cases}</div>
              <div className="mt-2 text-xs text-muted-foreground">runner list-cases</div>
            </div>
            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Runtime target</div>
              <div className="mt-2 truncate font-mono text-sm text-foreground" title={health.runtime_target}>{health.runtime_target}</div>
              <div className="mt-2 text-xs text-muted-foreground">P10 runner target</div>
            </div>
            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Runtime container</div>
                {health.container && (
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] ${healthClassName(health.container.status)}`}>
                    {health.container.status}
                  </span>
                )}
              </div>
              <div className="mt-2 truncate font-mono text-sm text-foreground" title={health.container?.name || ''}>{health.container?.name || '-'}</div>
              <div className="mt-2 text-xs text-muted-foreground">{health.container?.detail || 'not checked'}</div>
            </div>
          </section>

          <section className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">Harness Paths</h2>
              <div className="mt-3 grid gap-2">
                <div className="rounded-lg border border-border bg-background/45 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Harness root</div>
                  <div className="mt-1 truncate font-mono text-xs text-foreground" title={health.harness_root || ''}>{health.harness_root || '-'}</div>
                </div>
                <div className="rounded-lg border border-border bg-background/45 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Runner</div>
                  <div className="mt-1 truncate font-mono text-xs text-foreground" title={health.runner_path || ''}>{health.runner_path || '-'}</div>
                </div>
                <div className="rounded-lg border border-border bg-background/45 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Latest report</div>
                  <div className="mt-1 truncate font-mono text-xs text-foreground" title={health.latest_report?.path || ''}>{health.latest_report?.path || '-'}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{formatReportTime(health.latest_report?.updated_at)}</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">Suite Inventory</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {health.suites.map(suite => (
                  <div key={suite.id} className="rounded-lg border border-border bg-background/45 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{suite.label}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] ${healthClassName(suite.status)}`}>{suite.status}</span>
                    </div>
                    <div className="mt-2 font-mono text-xl font-semibold tabular-nums text-foreground">{suite.actual}/{suite.expected}</div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground" title={suite.file}>{suite.file}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card/70 shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Harness Checks</h2>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/60 uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Check</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background/30">
                {health.checks.map(check => (
                  <tr key={check.id} className="align-top">
                    <td className="px-3 py-2 font-medium text-foreground">{check.label}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] ${healthClassName(check.status)}`}>{check.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="break-words text-muted-foreground">{check.detail}</div>
                      {check.action && <div className="mt-1 text-amber-300">{check.action}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
