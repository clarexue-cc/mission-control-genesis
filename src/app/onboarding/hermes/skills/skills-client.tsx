'use client'

import { useEffect, useState } from 'react'
import { useMissionControl } from '@/store'
import {
  HermesFileBlock,
  HermesInfoCard,
  HermesPageShell,
  HermesStatusPill,
} from '@/app/onboarding/hermes/_components/hermes-placeholder-page'

interface SkillFile {
  id: string
  title: string
  relative_path: string
  exists: boolean
  content: string | null
  lines: number
}

interface GovernanceFile {
  title: string
  relative_path: string
  exists: boolean
  content: string | null
  lines: number
}

interface SkillsPayload {
  ok: boolean
  tenant_id: string
  skills: SkillFile[]
  governance: {
    cron_schedule: GovernanceFile
    approved_skills: GovernanceFile
  }
}

const DEFAULT_TENANT_ID = 'media-intel-agent'

export function HermesSkillsClient() {
  const { activeTenant } = useMissionControl()
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [data, setData] = useState<SkillsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const nextTenantId = params.get('tenant_id') || params.get('tenant') || activeTenant?.slug || DEFAULT_TENANT_ID
    const controller = new AbortController()
    setTenantId(nextTenantId)
    setLoading(true)
    setError('')
    fetch(`/api/onboarding/hermes/skills?tenant_id=${encodeURIComponent(nextTenantId)}`, {
      signal: controller.signal,
    })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error || '读取 Hermes Skills 失败')
        setData(body)
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setError(error?.message || '读取 Hermes Skills 失败')
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [activeTenant?.slug])

  const readyCount = data?.skills.filter(skill => skill.exists).length || 0

  return (
    <HermesPageShell
      title="H5 Skills 填充"
      description="展示 competitor-scan、trending-filter、user-demand-collect、low-fan-discovery、industry-scan 五个 Hermes Skill 草稿与治理排期。"
    >
      <HermesInfoCard
        title="Skills 状态"
        meta={<HermesStatusPill tone={readyCount === 5 ? 'success' : 'warning'}>{loading ? '读取中' : `${readyCount}/5 Skills 就绪`}</HermesStatusPill>}
      >
        <div className="text-sm text-muted-foreground">Tenant: <span className="font-mono text-foreground">{data?.tenant_id || tenantId}</span></div>
        {error && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </HermesInfoCard>

      <section className="grid gap-4">
        {(data?.skills || []).map(skill => (
          <details key={skill.id} className="rounded-lg border border-border bg-card p-5" open={skill.exists}>
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{skill.id}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{skill.title}</p>
                </div>
                <HermesStatusPill tone={skill.exists ? 'success' : 'danger'}>
                  {skill.exists ? `${skill.lines} 行` : '缺失'}
                </HermesStatusPill>
              </div>
            </summary>
            <pre className="mt-4 max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-4 font-mono text-sm leading-relaxed text-foreground/90">
              {skill.content || `${skill.relative_path} 缺失`}
            </pre>
          </details>
        ))}
      </section>

      <HermesFileBlock
        title="cron-schedule.yaml — Skill 排期"
        path="profile/cron-schedule.yaml"
        content={data?.governance.cron_schedule.content || null}
        exists={data?.governance.cron_schedule.exists || false}
        lines={data?.governance.cron_schedule.lines}
      />

      <HermesFileBlock
        title="approved-skills.json — Skill 审批与 Pin"
        path="profile/approved-skills.json"
        content={data?.governance.approved_skills.content || null}
        exists={data?.governance.approved_skills.exists || false}
        lines={data?.governance.approved_skills.lines}
      />
    </HermesPageShell>
  )
}
