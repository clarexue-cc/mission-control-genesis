'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useNavigateToPanel } from '@/lib/navigation'
import { useMissionControl } from '@/store'

interface BaseOption {
  id: 'oc' | 'hermes' | 'both'
  label: string
  status: 'recommended' | 'available' | 'blocked'
  isolation: string
  channels: string[]
  evidence: string[]
  blockers: string[]
}

interface BaseSelectionResponse {
  platform_ready: boolean
  phase0_dir: string | null
  templates: string[]
  selected: BaseOption['id'] | null
  options: BaseOption[]
}

const cardClass = 'rounded-lg border border-border bg-card/70'

function statusClass(status: BaseOption['status']) {
  if (status === 'recommended') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  if (status === 'available') return 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100'
  return 'border-border bg-background text-muted-foreground'
}

function statusLabel(status: BaseOption['status']) {
  if (status === 'recommended') return '推荐'
  if (status === 'available') return '可选'
  return '阻塞'
}

export function BaseSelectionPanel() {
  const navigateToPanel = useNavigateToPanel()
  const { activeTenant, setActiveTenant } = useMissionControl()
  const [data, setData] = useState<BaseSelectionResponse | null>(null)
  const [selected, setSelected] = useState<BaseOption['id'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadBaseSelection() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/harness/base-selection', { cache: 'no-store' })
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error || 'Failed to load base selection')
        if (!cancelled) {
          setData(body)
          setSelected((body?.selected || activeTenant?.base || null) as BaseOption['id'] | null)
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadBaseSelection().catch(() => {})
    return () => { cancelled = true }
  }, [activeTenant?.base])

  const selectedOption = data?.options.find(option => option.id === selected) || null
  const confirmSelection = () => {
    if (!selectedOption || selectedOption.status === 'blocked') return
    if (activeTenant) {
      setActiveTenant({ ...activeTenant, base: selectedOption.id })
    }
    navigateToPanel(selectedOption.id === 'hermes' ? 'onboarding/hermes/profile' : 'onboarding/customer')
  }

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <section className={`${cardClass} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Customer Onboarding</div>
            <h1 className="text-2xl font-semibold text-foreground">底座选型</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              基于平台就绪状态、模板和隔离要求选择客户接入底座。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => navigateToPanel('onboarding/platform-ready')}>
              平台就绪
            </Button>
            <Button onClick={confirmSelection} disabled={!selectedOption || selectedOption.status === 'blocked'}>
              确认底座
            </Button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
      {!loading && data && !data.platform_ready && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          平台就绪检查未全部通过，底座选型保持只读。
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4 lg:grid-cols-3">
          {loading && <div className={`${cardClass} p-4 text-sm text-muted-foreground`}>加载中...</div>}
          {(data?.options || []).map(option => {
            const active = selected === option.id
            return (
              <button
                key={option.id}
                type="button"
                disabled={option.status === 'blocked'}
                onClick={() => setSelected(option.id)}
                className={`rounded-lg border p-4 text-left transition ${
                  active
                    ? 'border-primary/70 bg-primary/10'
                    : 'border-border bg-card/70 hover:border-primary/40'
                } ${option.status === 'blocked' ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{option.label}</h2>
                    <div className="mt-1 text-xs text-muted-foreground">{option.isolation}</div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(option.status)}`}>
                    {statusLabel(option.status)}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {option.channels.map(channel => (
                    <span key={channel} className="rounded-full border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                      {channel}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
        </div>

        <div className={`${cardClass} p-4`}>
          <h2 className="text-sm font-semibold text-foreground">选型证据</h2>
          <div className="mt-3 rounded-lg border border-border bg-background p-3">
            <div className="text-xs text-muted-foreground">phase0</div>
            <div className="mt-1 break-all text-xs text-foreground">{data?.phase0_dir || '-'}</div>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Templates</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(data?.templates || []).map(template => (
                  <span key={template} className="rounded-full border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                    {template}
                  </span>
                ))}
                {!data?.templates?.length && <span className="text-xs text-muted-foreground">-</span>}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground">Evidence</div>
              <div className="mt-2 space-y-1">
                {(selectedOption?.evidence || []).map(item => (
                  <div key={item} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                    {item}
                  </div>
                ))}
                {!selectedOption?.evidence?.length && <div className="text-xs text-muted-foreground">-</div>}
              </div>
            </div>
            {Boolean(selectedOption?.blockers.length) && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">Blockers</div>
                <div className="mt-2 space-y-1">
                  {selectedOption?.blockers.map(item => (
                    <div key={item} className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
