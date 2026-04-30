'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

const suitePlainName: Record<string, string> = {
  golden: '正常能力',
  adversarial: '边界攻击',
  'cross-session': '跨会话记忆',
  drift: '角色漂移',
}

function healthClassName(status: HealthStatus | CheckStatus) {
  if (status === 'ready' || status === 'pass') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
  if (status === 'warning' || status === 'warn') return 'border-amber-500/30 bg-amber-500/10 text-amber-400'
  return 'border-red-500/30 bg-red-500/10 text-red-400'
}

function shortStatus(status: HealthStatus | CheckStatus) {
  if (status === 'ready' || status === 'pass') return 'OK'
  if (status === 'warning' || status === 'warn') return '注意'
  return '阻塞'
}

function sourceAbsolutePath(source: HarnessPlanSource, harnessRoot?: string | null) {
  if (source.absolute_path) return source.absolute_path
  if (!harnessRoot) return source.path
  return `${harnessRoot.replace(/\/$/, '')}/${source.path}`
}

function suiteSummary(suite: HarnessPlanSuite) {
  if (suite.id === 'golden') return '测客户 agent 正常能不能把该会的事做好。'
  if (suite.id === 'adversarial') return '测越权、泄密、注入、伪装等坏请求能不能拦住。'
  if (suite.id === 'cross-session') return '测换一个会话后，偏好、纠错和任务续接能不能召回。'
  if (suite.id === 'drift') return '测 agent 会不会跑偏角色，或误伤正常业务请求。'
  return suite.objective
}

function firstSourceByLabel(suite: HarnessPlanSuite, label: string) {
  return suite.sources.find(source => source.label === label)
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
      setError(loadError?.message || 'Failed to load harness')
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

  const suitePassCount = useMemo(() => health?.suites.filter(suite => suite.status === 'pass').length ?? 0, [health])
  const runtimeStatus = health?.container?.status || 'fail'

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <div className="rounded-lg border border-border bg-card/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Harness 工作台</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              这里先看结论，再看四套测试方向；路径和原始文档放在展开项里。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchHarness} disabled={refreshing}>
            {refreshing ? '刷新中...' : '刷新'}
          </Button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>

      {!health ? (
        <section className="rounded-lg border border-border bg-card/70 p-5 text-sm text-muted-foreground shadow-sm">
          Loading harness...
        </section>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">当前结论</div>
              <div className="mt-2 text-lg font-semibold text-foreground">
                {runtimeStatus === 'pass' ? '可以跑 P10' : '先修运行环境'}
              </div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                {runtimeStatus === 'pass'
                  ? 'runner 能打到当前 tenant。'
                  : health.container?.detail || 'runtime container 未就绪。'}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">题库状态</div>
              <div className="mt-2 flex items-end gap-2">
                <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">{health.total_cases}</span>
                <span className="pb-1 text-sm text-muted-foreground">cases</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{suitePassCount}/{health.suites.length} suites OK</div>
            </div>

            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">下一步</div>
              <div className="mt-2 text-lg font-semibold text-foreground">
                {runtimeStatus === 'pass' ? '去 P10 跑测试' : '修 ceo-assistant-v1 container'}
              </div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                {runtimeStatus === 'pass'
                  ? '再回 P10 看通过/失败和反馈。'
                  : '题库已就绪，阻塞点不是测试题。'}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">四套测试方向</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  想改方向就看对应卡片；想看原始题和文件位置再展开。
                </p>
              </div>
              {planError && <span className="text-xs text-red-300">{planError}</span>}
            </div>

            {!plan ? (
              <div className="mt-4 rounded-lg border border-border bg-background/45 p-4 text-sm text-muted-foreground">
                Loading test plan...
              </div>
            ) : (
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {plan.suites.map(suite => {
                  const suiteHealth = health.suites.find(item => item.id === suite.id)
                  const testSource = firstSourceByLabel(suite, '测试题') || suite.sources[0]
                  const supportSources = suite.sources.filter(source => source !== testSource)
                  const editPath = testSource ? sourceAbsolutePath(testSource, plan.harness_root) : '-'
                  const displayName = suitePlainName[suite.id] || suite.label

                  return (
                    <article key={suite.id} className="rounded-lg border border-border bg-background/45 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-foreground">{displayName}</h3>
                            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{suite.case_count}/{suite.expected}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{suite.label}</p>
                        </div>
                        {suiteHealth && (
                          <span className={`shrink-0 rounded border px-2 py-1 text-xs ${healthClassName(suiteHealth.status)}`}>
                            {shortStatus(suiteHealth.status)}
                          </span>
                        )}
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">测什么</div>
                          <p className="mt-1 text-sm leading-6 text-foreground">{suiteSummary(suite)}</p>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">改哪里</div>
                          <p className="mt-1 text-sm leading-6 text-foreground">
                            {testSource?.exists ? '测试题 markdown' : '测试题文件缺失'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {supportSources.length > 0 ? `另有 ${supportSources.length} 个支撑文档` : '没有额外支撑文档'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">如果不好，通常调</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {suite.optimization_targets.slice(0, 3).map(target => (
                            <span key={target} className="rounded-md border border-border bg-card/70 px-2 py-1 text-xs leading-5 text-muted-foreground">
                              {target}
                            </span>
                          ))}
                        </div>
                      </div>

                      <details className="mt-4 rounded-md border border-border bg-card/70 p-3">
                        <summary className="cursor-pointer text-sm font-medium text-foreground">看题目</summary>
                        <div className="mt-3 grid gap-2">
                          {suite.cases.slice(0, 4).map(testCase => (
                            <div key={testCase.testId} className="rounded-md border border-border bg-background/50 p-2">
                              <div className="font-mono text-[11px] text-foreground">{testCase.testId}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{testCase.title}</div>
                              <div className="mt-1 line-clamp-2 text-xs leading-5 text-foreground">{testCase.prompt}</div>
                            </div>
                          ))}
                          {suite.cases.length > 4 && <div className="text-[11px] text-muted-foreground">还有 {suite.cases.length - 4} 条。</div>}
                        </div>
                        {testSource?.preview && (
                          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                            {testSource.preview}
                          </pre>
                        )}
                      </details>

                      <details className="mt-3 rounded-md border border-border bg-card/70 p-3">
                        <summary className="cursor-pointer text-sm font-medium text-foreground">看修改入口</summary>
                        <div className="mt-3 space-y-3">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">测试题文件</div>
                            <div className="mt-1 break-all font-mono text-xs text-foreground">{editPath}</div>
                          </div>
                          {supportSources.map(source => (
                            <div key={`${suite.id}-${source.path}`}>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{source.label}</div>
                              <div className="mt-1 break-all font-mono text-xs text-foreground">{sourceAbsolutePath(source, plan.harness_root)}</div>
                            </div>
                          ))}
                        </div>
                      </details>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="grid gap-3 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,0.38fr)]">
            <div className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">运行检查</h2>
              <div className="mt-3 overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/60 uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">项</th>
                      <th className="px-3 py-2">状态</th>
                      <th className="px-3 py-2">结论</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-background/30">
                    {health.checks.map(check => (
                      <tr key={check.id} className="align-top">
                        <td className="px-3 py-2 font-medium text-foreground">{check.label}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[11px] ${healthClassName(check.status)}`}>{shortStatus(check.status)}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="break-words text-muted-foreground">{check.detail}</div>
                          {check.action && <div className="mt-1 text-foreground">{check.action}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <details className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-foreground">底层路径</summary>
              <div className="mt-3 space-y-3 text-xs">
                <div>
                  <div className="font-semibold uppercase tracking-wide text-muted-foreground">Harness root</div>
                  <div className="mt-1 break-all font-mono text-foreground">{health.harness_root || '-'}</div>
                </div>
                <div>
                  <div className="font-semibold uppercase tracking-wide text-muted-foreground">Runner</div>
                  <div className="mt-1 break-all font-mono text-foreground">{health.runner_path || '-'}</div>
                </div>
                <div>
                  <div className="font-semibold uppercase tracking-wide text-muted-foreground">Latest report</div>
                  <div className="mt-1 break-all font-mono text-foreground">{health.latest_report?.path || '-'}</div>
                </div>
              </div>
            </details>
          </section>
        </>
      )}
    </div>
  )
}
