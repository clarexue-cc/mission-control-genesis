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
  title: string
  relative_path: string
  exists: boolean
  content: string | null
  lines: number
}

interface DeployPayload {
  ok: boolean
  tenant_id: string
  files: {
    identity_config: HermesFile
    harness_meta: HermesFile
    hermes: HermesFile
  }
  vault: {
    agent_intel_path: string
    agent_intel_files: string[]
    agent_shared_path: string
    agent_shared_files: string[]
  }
}

const DEFAULT_TENANT_ID = 'media-intel-agent'

function VaultList({ title, path, entries }: { title: string; path: string; entries: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        <span className="font-mono text-xs text-muted-foreground">{path}</span>
      </div>
      <ul className="mt-4 grid gap-2 text-sm md:grid-cols-2">
        {entries.length > 0 ? entries.map(entry => (
          <li key={entry} className="rounded-md border border-border bg-card px-3 py-2 font-mono">
            {entry}
          </li>
        )) : (
          <li className="text-muted-foreground">目录为空或尚未初始化。</li>
        )}
      </ul>
    </div>
  )
}

export function HermesDeployClient() {
  const { activeTenant } = useMissionControl()
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [data, setData] = useState<DeployPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const nextTenantId = params.get('tenant_id') || params.get('tenant') || activeTenant?.slug || DEFAULT_TENANT_ID
    const controller = new AbortController()
    setTenantId(nextTenantId)
    setLoading(true)
    setError('')
    fetch(`/api/onboarding/hermes/deploy?tenant_id=${encodeURIComponent(nextTenantId)}`, {
      signal: controller.signal,
    })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error || '读取 Hermes 部署配置失败')
        setData(body)
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setError(error?.message || '读取 Hermes 部署配置失败')
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [activeTenant?.slug])

  const files = data ? [data.files.identity_config, data.files.harness_meta, data.files.hermes] : []
  const readyCount = files.filter(file => file.exists).length

  return (
    <HermesPageShell
      title="H3 部署配置 Deploy"
      description="展示 Hermes identity/config.yaml、harness-meta.json、hermes.json 与 vault 初始化目录状态。"
    >
      <HermesInfoCard
        title="Deploy 状态"
        meta={<HermesStatusPill tone={readyCount === 3 ? 'success' : 'warning'}>{loading ? '读取中' : `${readyCount}/3 配置就绪`}</HermesStatusPill>}
      >
        <div className="text-sm text-muted-foreground">Tenant: <span className="font-mono text-foreground">{data?.tenant_id || tenantId}</span></div>
        {error && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </HermesInfoCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <VaultList title="Agent-情报搜集" path="vault/Agent-情报搜集" entries={data?.vault.agent_intel_files || []} />
        <VaultList title="Agent-Shared" path="vault/Agent-Shared" entries={data?.vault.agent_shared_files || []} />
      </div>

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
