'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

type HealthStatus = 'ready' | 'warning' | 'blocked'
type CheckStatus = 'pass' | 'warn' | 'fail'
type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

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

const panelClassName = 'rounded-lg border border-border bg-card/80 shadow-sm'

const suitePlainName: Record<string, string> = {
  golden: '正常能力',
  adversarial: '边界攻击',
  'cross-session': '跨会话记忆',
  drift: '角色漂移',
}

const suiteAccent: Record<string, { ring: string; tint: string; dot: string; label: string }> = {
  golden: {
    ring: 'border-l-emerald-500/70',
    tint: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
    dot: 'bg-emerald-400',
    label: '业务能力',
  },
  adversarial: {
    ring: 'border-l-red-500/70',
    tint: 'bg-red-500/10 text-red-300 border-red-500/25',
    dot: 'bg-red-400',
    label: '安全边界',
  },
  'cross-session': {
    ring: 'border-l-sky-500/70',
    tint: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
    dot: 'bg-sky-400',
    label: '记忆召回',
  },
  drift: {
    ring: 'border-l-violet-500/70',
    tint: 'bg-violet-500/10 text-violet-300 border-violet-500/25',
    dot: 'bg-violet-400',
    label: '角色稳定',
  },
}

function toneClassName(tone: Tone) {
  if (tone === 'success') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (tone === 'warning') return 'border-amber-500/40 bg-amber-500/12 text-amber-200'
  if (tone === 'danger') return 'border-red-500/35 bg-red-500/10 text-red-300'
  if (tone === 'info') return 'border-primary/30 bg-primary/10 text-primary'
  return 'border-border bg-background/70 text-muted-foreground'
}

function statusMeta(status: HealthStatus | CheckStatus) {
  if (status === 'ready' || status === 'pass') {
    return {
      label: 'OK',
      icon: '✓',
      tone: 'success' as Tone,
      dot: 'bg-emerald-400',
    }
  }
  if (status === 'warning' || status === 'warn') {
    return {
      label: '注意',
      icon: '!',
      tone: 'warning' as Tone,
      dot: 'bg-amber-300',
    }
  }
  return {
    label: '阻塞',
    icon: '×',
    tone: 'danger' as Tone,
    dot: 'bg-red-400',
  }
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

function MetricCard({
  label,
  value,
  detail,
  meta,
}: {
  label: string
  value: ReactNode
  detail: ReactNode
  meta?: ReturnType<typeof statusMeta>
}) {
  return (
    <section className={`${panelClassName} min-h-[132px] p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
        {meta && (
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${toneClassName(meta.tone)}`}>
            {meta.icon}
          </span>
        )}
      </div>
      <div className="mt-4 text-2xl font-semibold leading-tight text-foreground">{value}</div>
      <div className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</div>
    </section>
  )
}

function StatusPill({ status }: { status: HealthStatus | CheckStatus }) {
  const meta = statusMeta(status)
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${toneClassName(meta.tone)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

function CollapsibleBlock({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details className="group rounded-md border border-border bg-background/55" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-secondary/40">
        <span>{title}</span>
        <span className="text-xs text-muted-foreground transition group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-border px-3 py-3">
        {children}
      </div>
    </details>
  )
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
  const runtimeMeta = statusMeta(runtimeStatus)

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <header className={`${panelClassName} overflow-hidden`}>
        <div className="border-b border-border bg-secondary/25 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">Harness 工作台</h1>
                {health && <StatusPill status={health.status} />}
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                先看 harness 能不能用，再看四套测试方向；题目和修改入口都放在对应卡片里。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {health && (
                <span className="rounded-md border border-border bg-background/70 px-2.5 py-1 font-mono text-xs text-muted-foreground">
                  {health.tenant}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={fetchHarness} disabled={refreshing}>
                {refreshing ? '刷新中...' : '刷新'}
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="m-4 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </header>

      {!health ? (
        <section className={`${panelClassName} p-5 text-sm text-muted-foreground`}>
          Loading harness...
        </section>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <MetricCard
              label="当前结论"
              value={runtimeStatus === 'pass' ? '可以跑 P10' : '先修运行环境'}
              detail={runtimeStatus === 'pass'
                ? 'runner 能打到当前 tenant。'
                : health.container?.detail || 'runtime container 未就绪。'}
              meta={runtimeMeta}
            />

            <MetricCard
              label="题库状态"
              value={(
                <span className="flex items-end gap-2">
                  <span className="font-mono text-4xl tabular-nums">{health.total_cases}</span>
                  <span className="pb-1 text-sm font-normal text-muted-foreground">cases</span>
                </span>
              )}
              detail={`${suitePassCount}/${health.suites.length} suites OK`}
            />

            <MetricCard
              label="下一步"
              value={runtimeStatus === 'pass' ? '去 P10 跑测试' : '修 ceo-assistant-v1 container'}
              detail={runtimeStatus === 'pass'
                ? '再回 P10 看通过、失败和反馈。'
                : '题库已就绪，阻塞点不是测试题。'}
            />
          </section>

          <section className={`${panelClassName} p-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Test suites</div>
                <h2 className="mt-1 text-lg font-semibold text-foreground">四套测试方向</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  每张卡先说测什么、改哪里、现在状态；需要深看再展开题目和修改入口。
                </p>
              </div>
              {planError && (
                <span className="rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1 text-xs text-red-200">
                  {planError}
                </span>
              )}
            </div>

            {!plan ? (
              <div className="mt-4 rounded-lg border border-border bg-background/45 p-4 text-sm text-muted-foreground">
                Loading test plan...
              </div>
            ) : (
              <div className="mt-4 grid gap-3 xl:grid-cols-4">
                {plan.suites.map(suite => {
                  const suiteHealth = health.suites.find(item => item.id === suite.id)
                  const testSource = firstSourceByLabel(suite, '测试题') || suite.sources[0]
                  const supportSources = suite.sources.filter(source => source !== testSource)
                  const editPath = testSource ? sourceAbsolutePath(testSource, plan.harness_root) : '-'
                  const displayName = suitePlainName[suite.id] || suite.label
                  const accent = suiteAccent[suite.id] || suiteAccent.golden
                  const suiteMeta = statusMeta(suiteHealth?.status || 'fail')

                  return (
                    <article
                      key={suite.id}
                      className={`flex min-h-[520px] flex-col rounded-lg border border-border border-l-4 bg-background/45 p-4 shadow-sm transition hover:border-border/90 hover:bg-background/65 ${accent.ring}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
                            <h3 className="text-lg font-semibold leading-tight text-foreground">{displayName}</h3>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${accent.tint}`}>{accent.label}</span>
                            <span className="rounded-full border border-border bg-card/70 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                              {suite.case_count}/{suite.expected}
                            </span>
                          </div>
                        </div>
                        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${toneClassName(suiteMeta.tone)}`}>
                          {suiteMeta.icon}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3">
                        <div className="rounded-md border border-border bg-card/55 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">测什么</div>
                          <p className="mt-1 text-sm leading-6 text-foreground">{suiteSummary(suite)}</p>
                        </div>
                        <div className="rounded-md border border-border bg-card/55 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">改哪里</div>
                          <p className="mt-1 text-sm leading-6 text-foreground">
                            {testSource?.exists ? '测试题 markdown' : '测试题文件缺失'}
                          </p>
                          <p className="text-xs leading-5 text-muted-foreground">
                            {supportSources.length > 0 ? `另有 ${supportSources.length} 个支撑文档` : '没有额外支撑文档'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">如果不好，通常调</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {suite.optimization_targets.slice(0, 3).map(target => (
                            <span key={target} className="rounded-md border border-border bg-card/65 px-2 py-1 text-xs leading-5 text-muted-foreground">
                              {target}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="mt-auto space-y-2 pt-4">
                        <CollapsibleBlock title="看题目">
                          <div className="grid gap-2">
                            {suite.cases.slice(0, 4).map(testCase => (
                              <div key={testCase.testId} className="rounded-md border border-border bg-background/65 p-2">
                                <div className="font-mono text-[11px] text-foreground">{testCase.testId}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{testCase.title}</div>
                                <div className="mt-1 line-clamp-2 text-xs leading-5 text-foreground">{testCase.prompt}</div>
                              </div>
                            ))}
                            {suite.cases.length > 4 && (
                              <div className="text-[11px] text-muted-foreground">还有 {suite.cases.length - 4} 条。</div>
                            )}
                          </div>
                          {testSource?.preview && (
                            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card/70 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                              {testSource.preview}
                            </pre>
                          )}
                        </CollapsibleBlock>

                        <CollapsibleBlock title="看修改入口">
                          <div className="space-y-3">
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">测试题文件</div>
                              <div className="mt-1 break-all rounded-md border border-border bg-card/65 px-2 py-1.5 font-mono text-xs text-foreground">{editPath}</div>
                            </div>
                            {supportSources.map(source => (
                              <div key={`${suite.id}-${source.path}`}>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{source.label}</div>
                                <div className="mt-1 break-all rounded-md border border-border bg-card/65 px-2 py-1.5 font-mono text-xs text-foreground">
                                  {sourceAbsolutePath(source, plan.harness_root)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CollapsibleBlock>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="grid gap-3 lg:grid-cols-[minmax(0,0.64fr)_minmax(0,0.36fr)]">
            <div className={`${panelClassName} overflow-hidden`}>
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">运行检查</h2>
                <p className="mt-1 text-xs text-muted-foreground">这里看 harness 自身有没有准备好。</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/50 uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">项</th>
                      <th className="px-3 py-2">状态</th>
                      <th className="px-3 py-2">结论</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-background/20">
                    {health.checks.map(check => (
                      <tr key={check.id} className="align-top">
                        <td className="px-3 py-2 font-medium text-foreground">{check.label}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={check.status} />
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

            <CollapsibleBlock title="底层路径">
              <div className="space-y-3 text-xs">
                <div>
                  <div className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">Harness root</div>
                  <div className="mt-1 break-all rounded-md border border-border bg-card/65 px-2 py-1.5 font-mono text-foreground">{health.harness_root || '-'}</div>
                </div>
                <div>
                  <div className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">Runner</div>
                  <div className="mt-1 break-all rounded-md border border-border bg-card/65 px-2 py-1.5 font-mono text-foreground">{health.runner_path || '-'}</div>
                </div>
                <div>
                  <div className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">Latest report</div>
                  <div className="mt-1 break-all rounded-md border border-border bg-card/65 px-2 py-1.5 font-mono text-foreground">{health.latest_report?.path || '-'}</div>
                </div>
              </div>
            </CollapsibleBlock>
          </section>
        </>
      )}
    </div>
  )
}
