'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { customerBaseLabel, parseCustomerBase, type CustomerBase } from '@/lib/onboarding-base'
import { useMissionControl } from '@/store'

type GateStatus = 'pass' | 'warn' | 'fail' | 'pending'

interface GateCheck {
  id: string
  label: string
  base?: 'oc' | 'hermes' | 'shared'
  status: GateStatus
  severity: 'critical' | 'high' | 'medium'
  evidence_path: string | null
  detail: string
  next_action: string
}

interface GateResponse {
  available: boolean
  tenants: string[]
  base: CustomerBase
  tenant: {
    tenant_id: string
    tenant_name: string | null
  }
  phase: {
    id: string
    label: string
    description: string
  }
  summary: {
    total_checks: number
    pass: number
    warn: number
    fail: number
    pending: number
    blocking: number
    status: string
  }
  checks: GateCheck[]
  error?: string
}

const cardClass = 'rounded-lg border border-border bg-card/70'
const selectClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60'

const statusLabels: Record<GateStatus, string> = {
  pass: '通过',
  warn: '复核',
  fail: '阻塞',
  pending: '待补',
}

const statusClass: Record<GateStatus, string> = {
  pass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  fail: 'border-red-500/40 bg-red-500/10 text-red-200',
  pending: 'border-border bg-background text-muted-foreground',
}

function SummaryTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={`${cardClass} p-3`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
    </div>
  )
}

function CheckRow({ check }: { check: GateCheck }) {
  return (
    <div className="grid gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0 lg:grid-cols-[minmax(0,1fr)_120px_minmax(220px,0.8fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-foreground">{check.label}</h3>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{check.id}</span>
        </div>
        <div className="mt-1 break-words text-xs text-muted-foreground">{check.evidence_path || '无证据路径'}</div>
      </div>
      <div className="flex items-start">
        <span className={`rounded-full border px-2 py-1 text-xs ${statusClass[check.status]}`}>
          {statusLabels[check.status]}
        </span>
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        <div>{check.detail}</div>
        <div className="mt-1 text-foreground/80">{check.next_action}</div>
      </div>
    </div>
  )
}

export function GateTestingPanel() {
  const { activeTenant } = useMissionControl()
  const activeBase = parseCustomerBase(activeTenant?.base)
  const activeTenantSlug = activeTenant?.slug || ''
  const [data, setData] = useState<GateResponse | null>(null)
  const [tenantId, setTenantId] = useState(activeTenantSlug)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (tenant: string, base: CustomerBase) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (tenant) params.set('tenant', tenant)
      params.set('base', base)
      const response = await fetch(`/api/harness/gates?${params.toString()}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'Failed to load gate testing')
      setData(body)
      setTenantId((current) => current || body?.tenant?.tenant_id || '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTenantSlug) setTenantId(activeTenantSlug)
  }, [activeTenantSlug])

  useEffect(() => {
    load(tenantId || activeTenantSlug, activeBase).catch(() => {})
  }, [load, tenantId, activeTenantSlug, activeBase])

  const summary = data?.summary
  const blocked = useMemo(() => (summary?.blocking || 0) > 0, [summary])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <section className={`${cardClass} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold text-cyan-300">{data?.phase?.id || 'P10'}</div>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">闸门测试</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              按 {customerBaseLabel(data?.base || activeBase)} 底座汇总 OC、Hermes 与共享闸门证据。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={selectClass}
              value={tenantId}
              onChange={event => setTenantId(event.target.value)}
              disabled={loading || (data?.tenants || []).length === 0}
            >
              {(data?.tenants || (tenantId ? [tenantId] : [])).map(tenant => (
                <option key={tenant} value={tenant}>{tenant}</option>
              ))}
            </select>
            <Button variant="ghost" onClick={() => load(tenantId || activeTenantSlug, activeBase)} disabled={loading}>
              刷新
            </Button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      {loading && <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>}

      {!loading && data && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <SummaryTile label="总项" value={summary?.total_checks || 0} />
            <SummaryTile label="通过" value={summary?.pass || 0} />
            <SummaryTile label="复核" value={summary?.warn || 0} />
            <SummaryTile label="阻塞" value={summary?.fail || 0} />
            <SummaryTile label="待补" value={summary?.pending || 0} />
            <div className={`${cardClass} p-3`}>
              <div className="text-xs text-muted-foreground">状态</div>
              <div className={`mt-2 inline-flex rounded-full border px-2 py-1 text-xs ${blocked ? statusClass.fail : statusClass.pass}`}>
                {blocked ? 'Blocked' : 'Gate Ready'}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{customerBaseLabel(data.base)}</div>
            </div>
          </section>

          <section className={`${cardClass} overflow-hidden`}>
            <div className="border-b border-border px-4 py-3">
              <div className="text-sm font-semibold text-foreground">{data.tenant.tenant_id}</div>
              <div className="mt-1 text-xs text-muted-foreground">{data.tenant.tenant_name || '未命名 tenant'}</div>
            </div>
            <div>
              {data.checks.map(check => <CheckRow key={check.id} check={check} />)}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
