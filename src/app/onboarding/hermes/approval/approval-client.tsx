'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import {
  HermesFileBlock,
  HermesInfoCard,
  HermesPageShell,
  HermesStatusPill,
} from '@/app/onboarding/hermes/_components/hermes-placeholder-page'

interface HermesFile {
  relative_path: string
  exists: boolean
  content: string | null
  lines: number
}

interface ApprovalPayload {
  ok: boolean
  tenant_id: string
  blueprint: HermesFile
  profile_vars: HermesFile
  user_profile: HermesFile
}

type Decision = 'pending' | 'approved' | 'returned'

const DEFAULT_TENANT_ID = 'media-intel-agent'

export function HermesApprovalClient() {
  const { activeTenant } = useMissionControl()
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [data, setData] = useState<ApprovalPayload | null>(null)
  const [decision, setDecision] = useState<Decision>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const nextTenantId = params.get('tenant_id') || params.get('tenant') || activeTenant?.slug || DEFAULT_TENANT_ID
    const controller = new AbortController()
    setTenantId(nextTenantId)
    setLoading(true)
    setError('')
    fetch(`/api/onboarding/hermes/blueprint?tenant_id=${encodeURIComponent(nextTenantId)}`, {
      signal: controller.signal,
    })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error || '读取 Hermes 蓝图失败')
        setData(body)
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setError(error?.message || '读取 Hermes 蓝图失败')
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [activeTenant?.slug])

  const ready = Boolean(data?.blueprint.exists && data.profile_vars.exists && data.user_profile.exists)

  return (
    <HermesPageShell
      title="H2 审批 Approval"
      description="Clare 确认 H1 蓝图后，H3/H4/H5/H6 才能按同一 profile 口径继续执行。"
    >
      <HermesInfoCard
        title="审批检查"
        meta={<HermesStatusPill tone={ready ? 'success' : 'warning'}>{loading ? '读取中' : ready ? '可审批' : '待补齐'}</HermesStatusPill>}
      >
        <div className="grid gap-4 text-sm md:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Tenant</div>
            <div className="mt-1 font-mono">{data?.tenant_id || tenantId}</div>
          </div>
          <div>
            <div className="text-muted-foreground">H1 蓝图</div>
            <div className="mt-1">{data?.blueprint.exists ? 'intake-analysis.md 已存在' : 'intake-analysis.md 缺失'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">当前决策</div>
            <div className="mt-1">{decision === 'approved' ? '审批通过' : decision === 'returned' ? '退回修改' : '等待 Clare 确认'}</div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="button" onClick={() => setDecision('approved')} disabled={!ready}>
            审批通过
          </Button>
          <Button type="button" variant="outline" onClick={() => setDecision('returned')} disabled={!data?.blueprint.exists}>
            退回修改
          </Button>
        </div>
        {error && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </HermesInfoCard>

      <HermesFileBlock
        title="intake-analysis.md — 审批依据"
        path="vault/intake-analysis.md"
        content={data?.blueprint.content || null}
        exists={data?.blueprint.exists || false}
        lines={data?.blueprint.lines}
      />
    </HermesPageShell>
  )
}
