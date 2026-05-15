'use client'

import { useEffect, useState } from 'react'
import { useMissionControl } from '@/store'
import {
  HermesFileBlock,
  HermesInfoCard,
  HermesPageShell,
  HermesStatusPill,
} from '@/app/onboarding/hermes/_components/hermes-placeholder-page'

interface GovernanceFile {
  title: string
  relative_path: string
  exists: boolean
  content: string | null
  lines: number
}

interface GovernancePayload {
  ok: boolean
  tenant_id: string
  files: {
    boundary_rules: GovernanceFile
    cron_schedule: GovernanceFile
    approved_skills: GovernanceFile
  }
}

const DEFAULT_TENANT_ID = 'media-intel-agent'

export function HermesGovernanceConfigClient() {
  const { activeTenant } = useMissionControl()
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [data, setData] = useState<GovernancePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const nextTenantId = params.get('tenant_id') || params.get('tenant') || activeTenant?.slug || DEFAULT_TENANT_ID
    const controller = new AbortController()
    setTenantId(nextTenantId)
    setLoading(true)
    setError('')
    fetch(`/api/onboarding/hermes/governance-config?tenant_id=${encodeURIComponent(nextTenantId)}`, {
      signal: controller.signal,
    })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error || '读取 Hermes 治理配置失败')
        setData(body)
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setError(error?.message || '读取 Hermes 治理配置失败')
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [activeTenant?.slug])

  const files = data ? [data.files.boundary_rules, data.files.cron_schedule, data.files.approved_skills] : []
  const readyCount = files.filter(file => file.exists).length

  return (
    <HermesPageShell
      title="H6 治理配置"
      description="展示 boundary-rules.json、cron-schedule.yaml、approved-skills.json；output-checker、memory-config、cron-registry 后续由治理生成器补齐。"
    >
      <HermesInfoCard
        title="Governance Config 状态"
        meta={<HermesStatusPill tone={readyCount === 3 ? 'success' : 'warning'}>{loading ? '读取中' : `${readyCount}/3 治理文件就绪`}</HermesStatusPill>}
      >
        <div className="text-sm text-muted-foreground">Tenant: <span className="font-mono text-foreground">{data?.tenant_id || tenantId}</span></div>
        {error && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </HermesInfoCard>

      {files.map(file => (
        <HermesFileBlock
          key={file.relative_path}
          title={file.title}
          path={file.relative_path}
          content={file.content}
          exists={file.exists}
          lines={file.lines}
        />
      ))}
    </HermesPageShell>
  )
}
