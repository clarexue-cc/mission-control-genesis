'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useNavigateToPanel } from '@/lib/navigation'

type ReadinessStatus = 'pass' | 'warn' | 'fail'

interface ReadinessCheck {
  id: string
  label: string
  status: ReadinessStatus
  required: boolean
  detail: string
  path?: string
}

interface PlatformReadinessResponse {
  ready: boolean
  phase0_dir: string | null
  checks: ReadinessCheck[]
  summary: {
    passed: number
    total: number
    required_passed: number
    required_total: number
  }
}

const cardClass = 'rounded-lg border border-border bg-card/70'

function statusClass(status: ReadinessStatus) {
  if (status === 'pass') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  if (status === 'warn') return 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  return 'border-red-500/40 bg-red-500/10 text-red-200'
}

function statusLabel(status: ReadinessStatus) {
  if (status === 'pass') return '通过'
  if (status === 'warn') return '观察'
  return '失败'
}

export function PlatformReadyPanel() {
  const navigateToPanel = useNavigateToPanel()
  const [data, setData] = useState<PlatformReadinessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadReadiness() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/harness/platform-readiness', { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'Failed to load platform readiness')
      setData(body)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReadiness().catch(() => {})
  }, [])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <section className={`${cardClass} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Customer Onboarding</div>
            <h1 className="text-2xl font-semibold text-foreground">平台就绪</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Mission Control、phase0、tenant vault、模板和关键 API 的只读检查。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => loadReadiness()} disabled={loading}>
              刷新
            </Button>
            <Button onClick={() => navigateToPanel('onboarding/base-selection')} disabled={!data?.ready}>
              底座选型
            </Button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className={`${cardClass} p-4`}>
          <h2 className="text-sm font-semibold text-foreground">状态</h2>
          <div className={data?.ready ? 'mt-4 text-4xl font-semibold text-emerald-300' : 'mt-4 text-4xl font-semibold text-amber-200'}>
            {loading ? '...' : data?.ready ? 'Ready' : 'Pending'}
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {data?.summary
              ? `${data.summary.required_passed}/${data.summary.required_total} 必需项通过`
              : '等待检查结果'}
          </div>
          <div className="mt-4 rounded-lg border border-border bg-background p-3">
            <div className="text-xs text-muted-foreground">phase0</div>
            <div className="mt-1 break-all text-xs text-foreground">{data?.phase0_dir || '-'}</div>
          </div>
        </div>

        <div className={`${cardClass} overflow-hidden`}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">检查项</h2>
          </div>
          <div className="divide-y divide-border">
            {loading && <div className="p-4 text-sm text-muted-foreground">加载中...</div>}
            {(data?.checks || []).map(item => (
              <div key={item.id} className="grid gap-3 px-4 py-4 md:grid-cols-[180px_minmax(0,1fr)_92px] md:items-center">
                <div>
                  <div className="text-sm font-medium text-foreground">{item.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.required ? 'Required' : 'Optional'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-muted-foreground">{item.detail}</div>
                  {item.path && <div className="mt-1 truncate text-xs text-muted-foreground/70">{item.path}</div>}
                </div>
                <div className={`rounded-full border px-2.5 py-1 text-center text-xs ${statusClass(item.status)}`}>
                  {statusLabel(item.status)}
                </div>
              </div>
            ))}
            {!loading && !data?.checks?.length && (
              <div className="p-4 text-sm text-muted-foreground">暂无检查项。</div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
