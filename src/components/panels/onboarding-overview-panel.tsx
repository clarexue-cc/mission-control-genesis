'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { customerCheckpointNavItems } from '@/lib/customer-checkpoint-navigation'
import { useNavigateToPanel } from '@/lib/navigation'
import { useMissionControl } from '@/store'

type PhaseStatus = 'done' | 'current' | 'pending' | 'blocked'

interface PhaseSummary {
  id: string
  label: string
  status: PhaseStatus
  panel: string
  detail: string
}

interface PhaseResponse {
  tenant: string | null
  platform_ready: boolean
  base_selected: boolean
  current_phase: PhaseSummary
  phases: PhaseSummary[]
  checkpoints: typeof customerCheckpointNavItems
}

interface DeployStateSlim {
  vault_tree: { name: string; type: string; children?: DeployStateSlim['vault_tree'] }[]
  confirmation_exists: boolean
  deploy_status: { status: string; mode: string } | null
}

function treeHasFile(tree: DeployStateSlim['vault_tree'] | undefined, name: string): boolean {
  for (const node of tree || []) {
    if (node.name === name) return true
    if (node.children && treeHasFile(node.children, name)) return true
  }
  return false
}

const cardClass = 'rounded-lg border border-border bg-card/70'

function statusClass(status: PhaseStatus) {
  if (status === 'done') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  if (status === 'current') return 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100'
  if (status === 'blocked') return 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  return 'border-border bg-background text-muted-foreground'
}

function statusLabel(status: PhaseStatus) {
  if (status === 'done') return '已完成'
  if (status === 'current') return '当前'
  if (status === 'blocked') return '阻塞'
  return '待开始'
}

export function OnboardingOverviewPanel() {
  const navigateToPanel = useNavigateToPanel()
  const { activeTenant } = useMissionControl()
  const [data, setData] = useState<PhaseResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deployState, setDeployState] = useState<DeployStateSlim | null>(null)
  const [baseFromApi, setBaseFromApi] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadPhase() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/harness/onboarding/phase', { cache: 'no-store' })
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error || 'Failed to load onboarding phase')
        if (!cancelled) setData(body)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadPhase().catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    fetch('/api/harness/base-selection', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (body?.selected) setBaseFromApi(body.selected) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!activeTenant?.slug) return
    let cancelled = false
    fetch(`/api/onboarding/customer/deploy?tenant_id=${encodeURIComponent(activeTenant.slug)}`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (!cancelled && body?.ok) setDeployState(body) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeTenant?.slug])

  const effectiveBase = activeTenant?.base || baseFromApi

  const cpStatus = useMemo(() => {
    const s: Record<string, { done: boolean; current: boolean; summary: string }> = {}
    const base = effectiveBase
    const hasIntake = treeHasFile(deployState?.vault_tree, 'intake-raw.md')
    const hasBlueprint = treeHasFile(deployState?.vault_tree, 'intake-analysis.md')
    const hasConfirm = !!deployState?.confirmation_exists
    const deployed = deployState?.deploy_status?.status === 'success' || deployState?.deploy_status?.status === 'mock-success'
    const isMock = deployState?.deploy_status?.mode === 'mock-fallback'

    s['onboarding-overview'] = { done: true, current: false, summary: '全景面板' }
    s['platform-ready'] = { done: !!data?.platform_ready, current: !data?.platform_ready, summary: data?.platform_ready ? 'phase0 就绪' : '检查中' }
    s['base-selection'] = { done: !!base, current: !base && !!data?.platform_ready, summary: base ? (base === 'oc' ? 'OpenClaw' : base === 'hermes' ? 'Hermes' : '双底座') : '待选择' }

    s['p3-intake'] = { done: hasIntake, current: !hasIntake && base === 'oc', summary: hasIntake ? 'intake-raw.md 已收集' : '待收集' }
    s['p4-blueprint'] = { done: hasBlueprint, current: !hasBlueprint && hasIntake, summary: hasBlueprint ? '蓝图已生成' : '待生成' }
    s['p5-approval'] = { done: hasConfirm, current: !hasConfirm && hasBlueprint, summary: hasConfirm ? '签字确认' : '待签字' }
    s['p6-deploy'] = { done: deployed, current: !deployed && hasConfirm, summary: deployed ? (isMock ? 'Mock 部署完成' : '部署完成') : '待部署' }
    s['p7-soul-agents'] = { done: false, current: deployed, summary: deployed ? '待定稿' : '待部署先' }
    s['p8-boundary'] = { done: false, current: false, summary: '待配置' }
    s['p9-skills'] = { done: false, current: false, summary: '待配置' }

    for (const id of ['h01-profile-setup', 'h02-boundary-watchdog', 'h03-skill-curator', 'h04-memory-curator', 'h05-output-checker', 'h06-guardian', 'h07-cron-governance']) {
      s[id] = { done: false, current: false, summary: '待开始' }
    }
    s['gate-testing'] = { done: false, current: false, summary: '待测试' }
    s['pre-launch-oc'] = { done: false, current: false, summary: '待准备' }
    s['pre-launch-hermes'] = { done: false, current: false, summary: '待准备' }
    s['onboarding-delivery'] = { done: false, current: false, summary: '待交付' }
    return s
  }, [data, deployState, effectiveBase])

  const checkpoints = useMemo(() => data?.checkpoints || customerCheckpointNavItems, [data?.checkpoints])
  const grouped = useMemo(() => ({
    setup: checkpoints.filter(item => item.phase === 'setup'),
    ocBuild: checkpoints.filter(item => item.phase === 'oc-build'),
    hermesBuild: checkpoints.filter(item => item.phase === 'hermes-build'),
    gateTesting: checkpoints.filter(item => item.phase === 'gate-testing'),
    preLaunch: checkpoints.filter(item => item.phase === 'pre-launch'),
    delivery: checkpoints.filter(item => item.phase === 'delivery'),
  }), [checkpoints])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <section className={`${cardClass} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Customer Onboarding</div>
            <h1 className="text-2xl font-semibold text-foreground">全景总览</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              从平台就绪、底座选型、双底座构建、三道闸门到 UAT 交付的统一入口。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => navigateToPanel('onboarding/platform-ready')}>
              平台就绪
            </Button>
            <Button onClick={() => navigateToPanel(data?.current_phase?.panel || 'onboarding/platform-ready')}>
              当前阶段
            </Button>
          </div>
        </div>
      </section>

      {loading && <div className={`${cardClass} p-4 text-sm text-muted-foreground`}>加载中...</div>}
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="space-y-4">
          <div className={`${cardClass} p-4`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">阶段</h2>
              <span className="text-xs text-muted-foreground">{data?.tenant || 'tenant 未锁定'}</span>
            </div>
            <div className="mt-3 space-y-2">
              {(data?.phases || []).map(phase => (
                <button
                  key={phase.id}
                  type="button"
                  onClick={() => navigateToPanel(phase.panel)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition hover:border-primary/40 ${statusClass(phase.status)}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{phase.label}</span>
                    <span className="rounded-full border border-current/30 px-2 py-0.5 text-[11px]">{statusLabel(phase.status)}</span>
                  </div>
                  <div className="mt-1 text-xs opacity-80">{phase.detail}</div>
                </button>
              ))}
              {!loading && !data?.phases?.length && (
                <div className="text-sm text-muted-foreground">暂无阶段状态。</div>
              )}
            </div>
          </div>

          <div className={`${cardClass} p-4`}>
            <h2 className="text-sm font-semibold text-foreground">就绪信号</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-xs text-muted-foreground">平台</div>
                <div className={data?.platform_ready ? 'mt-1 text-sm font-semibold text-emerald-300' : 'mt-1 text-sm font-semibold text-amber-200'}>
                  {data?.platform_ready ? 'Ready' : 'Pending'}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-xs text-muted-foreground">底座</div>
                <div className={effectiveBase ? 'mt-1 text-sm font-semibold text-emerald-300' : 'mt-1 text-sm font-semibold text-amber-200'}>
                  {effectiveBase ? (effectiveBase === 'oc' ? '✅ OpenClaw' : effectiveBase === 'hermes' ? '✅ Hermes' : '✅ 双底座') : 'Pending'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`${cardClass} overflow-hidden`}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Checkpoint</h2>
          </div>
          <div className="divide-y divide-border">
            {[
              ['阶段 0-1', grouped.setup],
              ['OC 构建路径', grouped.ocBuild],
              ['Hermes 构建路径', grouped.hermesBuild],
              ['阶段 3', grouped.gateTesting],
              ['阶段 4', grouped.preLaunch],
              ['阶段 5-6', grouped.delivery],
            ].map(([label, items]) => (
              <div key={label as string} className="p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label as string}</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {(items as typeof customerCheckpointNavItems).map(item => {
                    const cs = cpStatus[item.id]
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigateToPanel(item.panel)}
                        className={`rounded-lg border px-3 py-2 text-left transition hover:border-primary/40 hover:bg-primary/5 ${
                          cs?.done ? 'border-emerald-500/30 bg-emerald-500/5' : cs?.current ? 'border-cyan-400/30 bg-cyan-400/5' : 'border-border bg-background'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium text-foreground">{item.label}</div>
                          {cs && (
                            <span className={`shrink-0 text-[11px] ${cs.done ? 'text-emerald-400' : cs.current ? 'text-cyan-300' : 'text-muted-foreground/60'}`}>
                              {cs.done ? '✅' : cs.current ? '⏳' : '⬜'}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="line-clamp-1 text-xs text-muted-foreground">{item.description}</span>
                          {cs && <span className={`shrink-0 text-[10px] ${cs.done ? 'text-emerald-400/80' : cs.current ? 'text-cyan-300/80' : 'text-muted-foreground/50'}`}>{cs.summary}</span>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
