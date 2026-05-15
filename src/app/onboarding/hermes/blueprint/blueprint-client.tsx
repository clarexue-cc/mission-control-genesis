'use client'

import { useEffect, useState } from 'react'
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
  json?: unknown
}

interface BlueprintPayload {
  ok: boolean
  tenant_id: string
  blueprint: HermesFile
  profile_vars: HermesFile
  user_profile: HermesFile
}

const DEFAULT_TENANT_ID = 'media-intel-agent'

export function HermesBlueprintClient() {
  const { activeTenant } = useMissionControl()
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [data, setData] = useState<BlueprintPayload | null>(null)
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

  const readyCount = data
    ? [data.blueprint.exists, data.profile_vars.exists, data.user_profile.exists].filter(Boolean).length
    : 0

  return (
    <HermesPageShell
      title="H1 蓝图 Blueprint"
      description="展示 H1 产出的 intake-analysis.md、profile-vars.json 与 USER.md 草稿，作为 Hermes profile 初始化依据。"
    >
      <HermesInfoCard
        title="Blueprint 状态"
        meta={<HermesStatusPill tone={readyCount === 3 ? 'success' : 'warning'}>{loading ? '读取中' : `${readyCount}/3 就绪`}</HermesStatusPill>}
      >
        <dl className="grid gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Tenant</dt>
            <dd className="mt-1 font-mono text-foreground">{data?.tenant_id || tenantId}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">蓝图源</dt>
            <dd className="mt-1 font-mono text-foreground">vault/intake-analysis.md</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Profile 元数据</dt>
            <dd className="mt-1 font-mono text-foreground">profile/profile-vars.json</dd>
          </div>
        </dl>
        {error && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </HermesInfoCard>

      <HermesFileBlock
        title="intake-analysis.md — Hermes 蓝图全文"
        path="vault/intake-analysis.md"
        content={data?.blueprint.content || null}
        exists={data?.blueprint.exists || false}
        lines={data?.blueprint.lines}
      />

      <HermesInfoCard title="profile-vars.json — Profile 元数据">
        {data?.profile_vars.json ? (
          <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground/90">
            {JSON.stringify(data.profile_vars.json, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data?.profile_vars.exists ? 'profile-vars.json 不是可解析 JSON。' : 'profile/profile-vars.json 缺失。'}
          </p>
        )}
      </HermesInfoCard>

      <HermesFileBlock
        title="USER.md — 用户画像预览"
        path="profile/USER.md"
        content={data?.user_profile.content || null}
        exists={data?.user_profile.exists || false}
        lines={data?.user_profile.lines}
      />
    </HermesPageShell>
  )
}
