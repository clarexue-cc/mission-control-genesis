'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { customerCheckpointNavItems } from '@/lib/customer-checkpoint-navigation'
import { useNavigateToPanel } from '@/lib/navigation'

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
  const [data, setData] = useState<PhaseResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const checkpoints = useMemo(() => data?.checkpoints || customerCheckpointNavItems, [data?.checkpoints])
  const grouped = useMemo(() => ({
    setup: checkpoints.filter(item => item.phase === 'setup'),
    admin: checkpoints.filter(item => item.phase === 'delivery-admin'),
    customer: checkpoints.filter(item => item.phase === 'delivery-customer'),
  }), [checkpoints])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <section className={`${cardClass} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Customer Onboarding</div>
            <h1 className="text-2xl font-semibold text-foreground">全景总览</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              从平台就绪、底座选型到 P3-P16 客户交付链的统一入口。
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
                <div className={data?.base_selected ? 'mt-1 text-sm font-semibold text-emerald-300' : 'mt-1 text-sm font-semibold text-amber-200'}>
                  {data?.base_selected ? 'Selected' : 'Pending'}
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
              ['前置', grouped.setup],
              ['交付', grouped.admin],
              ['客户验收', grouped.customer],
            ].map(([label, items]) => (
              <div key={label as string} className="p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label as string}</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {(items as typeof customerCheckpointNavItems).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateToPanel(item.panel)}
                      className="rounded-lg border border-border bg-background px-3 py-2 text-left transition hover:border-primary/40 hover:bg-primary/5"
                    >
                      <div className="text-sm font-medium text-foreground">{item.label}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
