'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { customerBaseLabel, parseCustomerBase, type CustomerBase } from '@/lib/onboarding-base'
import { useMissionControl } from '@/store'

type CheckStatus = 'pass' | 'warn' | 'fail' | 'pending'

interface PreLaunchCheck {
  id: string
  label: string
  base?: 'oc' | 'hermes' | 'shared'
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  status: CheckStatus
  expected: string
  evidence: string
  fail_hint: string
}

interface PreLaunchResponse {
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
  rules: {
    path: string | null
    version: string
    total: number
  }
  readiness: {
    status: 'ready' | 'warning' | 'blocked' | 'pending'
    label: string
    blocking: number
    warning: number
  }
  checks: PreLaunchCheck[]
  error?: string
}

const cardClass = 'rounded-lg border border-border bg-card/70'
const selectClass = 'rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60'

const statusLabels: Record<CheckStatus, string> = {
  pass: '通过',
  warn: '复核',
  fail: '阻塞',
  pending: '待执行',
}

const statusClass: Record<CheckStatus, string> = {
  pass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  fail: 'border-red-500/40 bg-red-500/10 text-red-200',
  pending: 'border-border bg-background text-muted-foreground',
}

function readinessClass(status: PreLaunchResponse['readiness']['status']) {
  if (status === 'ready') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  if (status === 'blocked') return 'border-red-500/40 bg-red-500/10 text-red-200'
  if (status === 'warning') return 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  return 'border-border bg-background text-muted-foreground'
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={`${cardClass} p-3`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
    </div>
  )
}

function CheckCard({ check }: { check: PreLaunchCheck }) {
  return (
    <div className={`${cardClass} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{check.label}</h3>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{check.id}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{check.category} · {check.severity}</div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-xs ${statusClass[check.status]}`}>
          {statusLabels[check.status]}
        </span>
      </div>
      <div className="mt-3 space-y-2 text-xs">
        <div>
          <span className="text-muted-foreground">证据：</span>
          <span className="text-foreground/85">{check.evidence}</span>
        </div>
        {check.expected && (
          <div>
            <span className="text-muted-foreground">标准：</span>
            <span className="text-foreground/85">{check.expected}</span>
          </div>
        )}
        {check.status !== 'pass' && check.fail_hint && (
          <div className="rounded-md border border-border bg-background/70 p-2 text-muted-foreground">
            {check.fail_hint}
          </div>
        )}
      </div>
    </div>
  )
}

export function PreLaunchPanel() {
  const { activeTenant } = useMissionControl()
  const activeBase = parseCustomerBase(activeTenant?.base)
  const activeTenantSlug = activeTenant?.slug || ''
  const [data, setData] = useState<PreLaunchResponse | null>(null)
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
      const response = await fetch(`/api/harness/pre-launch?${params.toString()}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'Failed to load pre-launch checks')
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

  const statusCounts = useMemo(() => {
    const checks = data?.checks || []
    return {
      pass: checks.filter(check => check.status === 'pass').length,
      warn: checks.filter(check => check.status === 'warn').length,
      fail: checks.filter(check => check.status === 'fail').length,
      pending: checks.filter(check => check.status === 'pending').length,
    }
  }, [data])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <section className={`${cardClass} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold text-cyan-300">{data?.phase?.id || 'P12'}</div>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">上线准备</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              按 {customerBaseLabel(data?.base || activeBase)} 底座执行 Ready-to-Ship 检查与出货判定。
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
              <div className="text-xs text-muted-foreground">出货状态</div>
              <div className={`mt-2 inline-flex rounded-full border px-2 py-1 text-sm ${readinessClass(data.readiness.status)}`}>
                {data.readiness.label}
              </div>
              <div className="mt-2 truncate text-xs text-muted-foreground">{data.tenant.tenant_id}</div>
              <div className="mt-1 text-xs text-muted-foreground">{customerBaseLabel(data.base)}</div>
            </div>
            <Stat label="通过" value={statusCounts.pass} />
            <Stat label="复核" value={statusCounts.warn} />
            <Stat label="阻塞" value={statusCounts.fail} />
            <Stat label="待执行" value={statusCounts.pending} />
          </section>

          <section className={`${cardClass} p-4`}>
            <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-3">
              <div>
                <span className="text-foreground">规则版本：</span>
                {data.rules.version}
              </div>
              <div>
                <span className="text-foreground">检查项：</span>
                {data.rules.total}
              </div>
              <div className="truncate">
                <span className="text-foreground">规则文件：</span>
                {data.rules.path || '未找到'}
              </div>
            </div>
          </section>

          <section className="grid gap-3 xl:grid-cols-2">
            {data.checks.map(check => <CheckCard key={check.id} check={check} />)}
          </section>
        </>
      )}
    </div>
  )
}
