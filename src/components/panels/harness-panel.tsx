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

interface HarnessPlanSource {
  label: string
  path: string
  absolute_path?: string
  exists: boolean
  preview?: string | null
}

interface HarnessPlanCase {
  testId: string
  title: string
  prompt: string
}

interface HarnessPlanSuite {
  id: string
  label: string
  expected: number
  case_count: number
  checkpoint: string
  objective: string
  sources: HarnessPlanSource[]
  criteria: string[]
  failure_modes: string[]
  optimization_targets: string[]
  cases: HarnessPlanCase[]
}

interface HarnessPlan {
  tenant: string
  template: string
  total: number
  harness_root: string
  runner_path: string
  suites: HarnessPlanSuite[]
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

function sourceAbsolutePath(source: HarnessPlanSource, harnessRoot?: string | null) {
  if (source.absolute_path) return source.absolute_path
  if (!harnessRoot) return source.path
  return `${harnessRoot.replace(/\/$/, '')}/${source.path}`
}

export function HarnessPanel() {
  const [health, setHealth] = useState<HarnessHealth | null>(null)
  const [plan, setPlan] = useState<HarnessPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchHarness = useCallback(async () => {
    setRefreshing(true)
    try {
      const params = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
      const tenant = params?.get('tenant') || params?.get('tenant_id') || resolveDefaultCustomerTenantId()
      const [healthResponse, planResponse] = await Promise.all([
        fetch(`/api/harness/health?tenant=${encodeURIComponent(tenant)}`),
        fetch(`/api/harness/test-plan?tenant=${encodeURIComponent(tenant)}`),
      ])

      const healthBody = await healthResponse.json().catch(() => null)
      if (!healthResponse.ok) throw new Error(healthBody?.error || `HTTP ${healthResponse.status}`)
      setHealth(healthBody as HarnessHealth)
      setError(null)

      const planBody = await planResponse.json().catch(() => null)
      if (!planResponse.ok) {
        setPlan(null)
        setPlanError(planBody?.error || `HTTP ${planResponse.status}`)
      } else {
        setPlan(planBody as HarnessPlan)
        setPlanError(null)
      }
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load harness health')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchHarness()
    const timer = setInterval(() => {
      void fetchHarness()
    }, 15000)
    return () => clearInterval(timer)
  }, [fetchHarness])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <div className="rounded-lg border border-border bg-card/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Harness Operations</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Harness owns the test documents and runner readiness. P10 consumes these documents to run tests and feed back what needs to change.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {health && (
              <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${healthClassName(health.status)}`}>
                {health.status}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={fetchHarness} disabled={refreshing}>
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
          <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.38fr)]">
            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tenant</div>
                  <div className="mt-2 break-all font-mono text-sm text-foreground">{health.tenant}</div>
                  <div className="mt-1 text-xs text-muted-foreground">template={health.template || '-'}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cases</div>
                  <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">{health.total_cases}</div>
                  <div className="mt-1 text-xs text-muted-foreground">runner list-cases</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Runtime target</div>
                  <div className="mt-2 break-all font-mono text-sm text-foreground">{health.runtime_target}</div>
                  <div className="mt-1 text-xs text-muted-foreground">P10 runner target</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">Runtime container</h2>
                {health.container && (
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] ${healthClassName(health.container.status)}`}>
                    {health.container.status}
                  </span>
                )}
              </div>
              <div className="mt-2 break-all font-mono text-sm text-foreground">{health.container?.name || '-'}</div>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">{health.container?.detail || 'not checked'}</div>
              {health.container?.status !== 'pass' && (
                <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-300">
                  先修 runtime/container 映射，再跑 P10；测试题本身已在下面列出。
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Test Documents</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  这里是调整测试方向和新增 case 的入口：测试题改 suite markdown，能力/边界问题改对应 SOUL、AGENTS、boundary 或 skills 文档。
                </p>
              </div>
              {planError && <span className="text-xs text-red-300">{planError}</span>}
            </div>

            {!plan ? (
              <div className="mt-4 rounded-lg border border-border bg-background/45 p-4 text-sm text-muted-foreground">
                Loading test documents...
              </div>
            ) : (
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {plan.suites.map(suite => {
                  const suiteHealth = health.suites.find(item => item.id === suite.id)
                  const testSource = suite.sources.find(source => source.label === '测试题') || suite.sources[0]
                  const supportSources = suite.sources.filter(source => source !== testSource)
                  const editPath = testSource ? sourceAbsolutePath(testSource, plan.harness_root) : '-'

                  return (
                    <article key={suite.id} className="rounded-lg border border-border bg-background/45 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-foreground">{suite.label}</h3>
                            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{suite.case_count}/{suite.expected}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{suite.checkpoint}</p>
                        </div>
                        {suiteHealth && (
                          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${healthClassName(suiteHealth.status)}`}>
                            {suiteHealth.status}
                          </span>
                        )}
                      </div>

                      <p className="mt-3 text-sm leading-6 text-foreground">{suite.objective}</p>

                      <div className="mt-4 grid gap-2">
                        <div className="rounded-md border border-border bg-card/70 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">查看路径</div>
                          <div className="mt-1 break-all font-mono text-xs text-foreground">{editPath}</div>
                        </div>
                        <div className="rounded-md border border-border bg-card/70 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">修改路径</div>
                          <div className="mt-1 break-all font-mono text-xs text-foreground">{editPath}</div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">调整方向</div>
                        <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                          {suite.optimization_targets.map(target => <li key={target}>{target}</li>)}
                        </ul>
                      </div>

                      {supportSources.length > 0 && (
                        <details className="mt-4 rounded-md border border-border bg-card/70 p-3">
                          <summary className="cursor-pointer text-xs font-semibold text-foreground">支撑文档路径</summary>
                          <div className="mt-3 space-y-2">
                            {supportSources.map(source => (
                              <div key={`${suite.id}-${source.path}`} className="min-w-0">
                                <div className="text-[11px] text-muted-foreground">{source.label} · {source.exists ? 'exists' : 'missing'}</div>
                                <div className="break-all font-mono text-[11px] text-foreground">{sourceAbsolutePath(source, plan.harness_root)}</div>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      <details className="mt-3 rounded-md border border-border bg-card/70 p-3" open={suite.id === 'golden'}>
                        <summary className="cursor-pointer text-xs font-semibold text-foreground">测试题预览</summary>
                        <div className="mt-3 grid gap-2">
                          {suite.cases.slice(0, 3).map(testCase => (
                            <div key={testCase.testId} className="rounded-md border border-border bg-background/50 p-2">
                              <div className="font-mono text-[11px] text-foreground">{testCase.testId}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{testCase.title}</div>
                              <div className="mt-1 line-clamp-2 text-xs leading-5 text-foreground">{testCase.prompt}</div>
                            </div>
                          ))}
                          {suite.cases.length > 3 && <div className="text-[11px] text-muted-foreground">还有 {suite.cases.length - 3} 条，完整内容在上面的测试题 markdown。</div>}
                        </div>
                        {testSource?.preview && (
                          <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                            {testSource.preview}
                          </pre>
                        )}
                      </details>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="grid gap-3 lg:grid-cols-[minmax(0,0.52fr)_minmax(0,0.48fr)]">
            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">Harness Paths</h2>
              <div className="mt-3 grid gap-2">
                <div className="rounded-lg border border-border bg-background/45 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Harness root</div>
                  <div className="mt-1 break-all font-mono text-xs text-foreground">{health.harness_root || '-'}</div>
                </div>
                <div className="rounded-lg border border-border bg-background/45 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Runner</div>
                  <div className="mt-1 break-all font-mono text-xs text-foreground">{health.runner_path || '-'}</div>
                </div>
                <div className="rounded-lg border border-border bg-background/45 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Latest report</div>
                  <div className="mt-1 break-all font-mono text-xs text-foreground">{health.latest_report?.path || '-'}</div>
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
