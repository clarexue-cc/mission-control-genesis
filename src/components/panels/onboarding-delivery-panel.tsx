'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { customerBaseLabel, parseCustomerBase, type CustomerBase } from '@/lib/onboarding-base'
import { useMissionControl } from '@/store'

type SectionStatus = 'pass' | 'warn' | 'fail' | 'pending'

interface DeliveryEvidence {
  label: string
  path: string
  exists: boolean
  bytes: number | null
  updated_at: string | null
}

interface DeliverySection {
  id: string
  label: string
  base?: 'oc' | 'hermes' | 'shared'
  status: SectionStatus
  evidence: DeliveryEvidence[]
  summary: string
  next_action: string
}

interface DeliveryResponse {
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
  report: {
    status: 'ready' | 'blocked' | 'needs_review' | 'pending'
    pass: number
    warn: number
    pending: number
    fail: number
    total: number
    summary: string
  }
  sections: DeliverySection[]
  error?: string
}

const cardClass = 'rounded-lg border border-border bg-card/70'
const selectClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60'

const statusLabels: Record<SectionStatus, string> = {
  pass: '完成',
  warn: '复核',
  fail: '阻塞',
  pending: '待补',
}

const statusClass: Record<SectionStatus, string> = {
  pass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  fail: 'border-red-500/40 bg-red-500/10 text-red-200',
  pending: 'border-border bg-background text-muted-foreground',
}

function reportLabel(status: DeliveryResponse['report']['status']) {
  if (status === 'ready') return 'Ready for Delivery'
  if (status === 'blocked') return 'Blocked'
  if (status === 'needs_review') return 'Needs Review'
  return 'Pending'
}

function reportClass(status: DeliveryResponse['report']['status']) {
  if (status === 'ready') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  if (status === 'blocked') return 'border-red-500/40 bg-red-500/10 text-red-200'
  if (status === 'needs_review') return 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  return 'border-border bg-background text-muted-foreground'
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return '-'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function EvidenceList({ evidence }: { evidence: DeliveryEvidence[] }) {
  return (
    <div className="mt-3 divide-y divide-border rounded-md border border-border bg-background/60">
      {evidence.map(item => (
        <div key={`${item.label}:${item.path}`} className="grid gap-2 px-3 py-2 text-xs md:grid-cols-[160px_minmax(0,1fr)_80px]">
          <div className="font-medium text-foreground">{item.label}</div>
          <div className="truncate text-muted-foreground">{item.path || '未生成'}</div>
          <div className={item.exists ? 'text-emerald-300' : 'text-muted-foreground'}>
            {item.exists ? formatBytes(item.bytes) : '缺失'}
          </div>
        </div>
      ))}
    </div>
  )
}

function SectionCard({ section, index }: { section: DeliverySection; index: number }) {
  return (
    <div className={`${cardClass} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-xs text-muted-foreground">
              {index + 1}
            </span>
            <h3 className="text-sm font-semibold text-foreground">{section.label}</h3>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{section.summary}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-xs ${statusClass[section.status]}`}>
          {statusLabels[section.status]}
        </span>
      </div>
      <EvidenceList evidence={section.evidence} />
      {section.status !== 'pass' && (
        <div className="mt-3 rounded-md border border-border bg-background/60 p-2 text-xs text-muted-foreground">
          {section.next_action}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={`${cardClass} p-3`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
    </div>
  )
}

export function OnboardingDeliveryPanel() {
  const { activeTenant } = useMissionControl()
  const activeBase = parseCustomerBase(activeTenant?.base)
  const activeTenantSlug = activeTenant?.slug || ''
  const [data, setData] = useState<DeliveryResponse | null>(null)
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
      const response = await fetch(`/api/harness/delivery-report?${params.toString()}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'Failed to load delivery report')
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

  const completion = useMemo(() => {
    if (!data?.report.total) return 0
    return Math.round((data.report.pass / data.report.total) * 100)
  }, [data])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <section className={`${cardClass} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold text-cyan-300">{data?.phase?.id || 'P16'}</div>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">验收交付</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              汇总 {customerBaseLabel(data?.base || activeBase)} 底座步骤、交付证据与验收摘要。
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
            <div className={`${cardClass} p-3 xl:col-span-2`}>
              <div className="text-xs text-muted-foreground">交付状态</div>
              <div className={`mt-2 inline-flex rounded-full border px-2 py-1 text-sm ${reportClass(data.report.status)}`}>
                {reportLabel(data.report.status)}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
                <div className="h-full rounded-full bg-cyan-400" style={{ width: `${completion}%` }} />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{customerBaseLabel(data.base)}</div>
            </div>
            <Stat label="完成" value={data.report.pass} />
            <Stat label="复核" value={data.report.warn} />
            <Stat label="待补" value={data.report.pending} />
            <Stat label="阻塞" value={data.report.fail} />
          </section>

          <section className={`${cardClass} p-4`}>
            <div className="text-sm font-semibold text-foreground">{data.tenant.tenant_id}</div>
            <div className="mt-1 text-xs text-muted-foreground">{data.tenant.tenant_name || '未命名 tenant'}</div>
            <div className="mt-2 text-xs text-muted-foreground">{data.report.summary}</div>
          </section>

          <section className="grid gap-3 xl:grid-cols-2">
            {data.sections.map((section, index) => (
              <SectionCard key={section.id} section={section} index={index} />
            ))}
          </section>
        </>
      )}
    </div>
  )
}
