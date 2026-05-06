'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getCustomerDeployStatusDisplay } from '@/lib/customer-deploy-display'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

interface VaultTreeNode {
  path: string
  name: string
  type: 'directory' | 'file'
  children?: VaultTreeNode[]
}

interface DeployStatus {
  status: string
  mode: string
  container: string
  deployed_at: string
  vault_initialized: boolean
  note: string
  script_path?: string
}

interface DeployState {
  ok: boolean
  tenant_id: string
  tenant_root: string
  confirmation_path: string
  confirmation_exists: boolean
  confirmation_preview: string
  deploy_status_path: string
  deploy_status: DeployStatus | null
  vault_tree: VaultTreeNode[]
}

interface DeployResult {
  ok: boolean
  tenant_id: string
  tenant_root: string
  already_deployed: boolean
  container: string
  deploy_status_path: string
  deploy_status: DeployStatus
  vault_tree: VaultTreeNode[]
}

type Progress = 'pending' | 'running' | 'success' | 'failed'
const DEFAULT_TENANT_ID = resolveDefaultCustomerTenantId()

function flattenNodes(nodes: VaultTreeNode[]): VaultTreeNode[] {
  return nodes.flatMap(node => [node, ...flattenNodes(node.children || [])])
}

function formatDeployTime(value?: string) {
  if (!value) return '未生成'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const VAULT_TEMPLATE_SOURCE = 'phase0/templates/vault-template'

const P6_TEMPLATE_DOCS = [
  { label: 'index.md', path: 'vault/index.md' },
  { label: 'Agent-Shared/shared-guide.md', path: 'vault/Agent-Shared/shared-guide.md' },
  { label: 'Agent-Shared/user-profile.md', path: 'vault/Agent-Shared/user-profile.md' },
  { label: 'Agent-Shared/project-state.md', path: 'vault/Agent-Shared/project-state.md' },
  { label: 'Agent-Shared/decisions-log.md', path: 'vault/Agent-Shared/decisions-log.md' },
  { label: 'Agent-TEMPLATE/working-context.md', path: 'vault/Agent-TEMPLATE/working-context.md' },
  { label: 'Agent-TEMPLATE/mistakes.md', path: 'vault/Agent-TEMPLATE/mistakes.md' },
]

const P6_TEMPLATE_DOC_PATHS = new Set(P6_TEMPLATE_DOCS.map(item => item.path))

function vaultFileHref(tenantId: string, logicalPath: string) {
  return `/onboarding/customer/vault-file?tenant=${encodeURIComponent(tenantId)}&path=${encodeURIComponent(logicalPath)}`
}

function fileStageInfo(node: VaultTreeNode): { label: string; className: string } | null {
  if (node.type !== 'file') return null
  if (P6_TEMPLATE_DOC_PATHS.has(node.path)) {
    return { label: 'P6', className: 'bg-emerald-600/15 text-emerald-800' }
  }
  if (node.path === 'vault/confirmation-cc.md') {
    return { label: 'P5', className: 'bg-background text-muted-foreground' }
  }
  if (node.path === 'vault/intake-raw.md') {
    return { label: 'P3', className: 'bg-background text-muted-foreground' }
  }
  if (node.path === 'vault/intake-analysis.md') {
    return { label: 'P4', className: 'bg-background text-muted-foreground' }
  }
  if (node.name.startsWith('intake-analysis.stale-')) {
    return { label: 'P4', className: 'bg-background text-muted-foreground' }
  }
  if (node.path === 'vault/Agent-Main/AGENTS.md' || node.path === 'vault/Agent-Main/SOUL.md') {
    return { label: 'P7', className: 'bg-background text-muted-foreground' }
  }
  if (node.path.startsWith('vault/skills/')) {
    return { label: 'P9', className: 'bg-background text-muted-foreground' }
  }
  return { label: '后续', className: 'bg-muted text-muted-foreground' }
}

function KeyInfo({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-3 ${highlight ? 'border-primary/40 bg-primary/10' : 'border-border bg-background'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 break-words text-sm font-semibold ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</div>
    </div>
  )
}

function VaultTreeRow({ node, tenantId, depth = 0 }: { node: VaultTreeNode; tenantId: string; depth?: number }) {
  const rawChildren = node.children || []
  const children = rawChildren.filter(child => child.name !== '.gitkeep')
  const fileStage = fileStageInfo(node)
  const isP6TemplateDoc = fileStage?.label === 'P6'
  const displayName = `${node.name}${node.type === 'directory' && !node.name.endsWith('/') ? '/' : ''}`
  const isDirectory = node.type === 'directory'
  const levelLabel = depth === 0 ? '根' : `L${depth}`
  return (
    <>
      <div className={`grid gap-2 border-b border-border border-l-4 px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
        isDirectory
          ? 'border-l-blue-500/60 bg-blue-500/10'
          : 'border-l-emerald-500/60 bg-emerald-500/10'
      }`}>
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * 34}px` }}>
          <span className="shrink-0 rounded-full bg-background px-2 py-1 text-[10px] font-semibold text-muted-foreground">{levelLabel}</span>
          <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold ${
            isDirectory
              ? 'border-blue-500/35 bg-blue-500/15 text-blue-800'
              : 'border-emerald-500/35 bg-emerald-500/15 text-emerald-800'
          }`}>
            {isDirectory ? '目录' : '文件'}
          </span>
          <span className={`min-w-0 break-all text-sm font-semibold ${isDirectory ? 'text-blue-950' : 'text-emerald-950'}`}>{displayName}</span>
        </div>
        {fileStage && (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${fileStage.className}`}>{fileStage.label}</span>
            {isP6TemplateDoc && (
              <Button asChild variant="outline" size="sm" className="h-7 px-3 text-xs">
                <Link href={vaultFileHref(tenantId, node.path)}>查看</Link>
              </Button>
            )}
          </div>
        )}
      </div>
      {children.map(child => (
        <VaultTreeRow key={child.path} node={child} tenantId={tenantId} depth={depth + 1} />
      ))}
    </>
  )
}

export function CustomerDeployClient({ username }: { username: string }) {
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [state, setState] = useState<DeployState | null>(null)
  const [result, setResult] = useState<DeployResult | null>(null)
  const [progress, setProgress] = useState<Progress>('pending')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const vaultTree = result?.vault_tree || state?.vault_tree || []
  const deployStatus = result?.deploy_status || state?.deploy_status || null
  const vaultReady = deployStatus?.vault_initialized === true
  const hasVaultTree = vaultTree.length > 0
  const deploymentReady = Boolean(deployStatus)
  const allVaultNodes = useMemo(() => flattenNodes(vaultTree), [vaultTree])
  const hasVaultPath = (logicalPath: string) => logicalPath === 'vault' ? hasVaultTree : allVaultNodes.some(node => node.path === logicalPath)
  const activeTenantId = result?.tenant_id || state?.tenant_id || tenantId
  const deployDisplay = getCustomerDeployStatusDisplay(deployStatus, activeTenantId)
  const deployStatusLabel = deploymentReady ? deployDisplay.statusLabel : '等待触发'
  const tenantVaultRoot = `phase0/tenants/${activeTenantId}/vault`

  async function loadState(nextTenantId = tenantId) {
    const normalizedTenantId = nextTenantId.trim() || DEFAULT_TENANT_ID
    setTenantId(normalizedTenantId)
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/onboarding/customer/deploy?tenant_id=${encodeURIComponent(normalizedTenantId)}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '读取 OB-S4 状态失败')
      setState(body)
      setResult(null)
      setProgress(body.deploy_status ? 'success' : 'pending')
    } catch (err: any) {
      setError(err?.message || '读取 OB-S4 状态失败')
      setState(null)
      setResult(null)
      setProgress('failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    loadState(params.get('tenant') || params.get('tenant_id') || DEFAULT_TENANT_ID)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function deploy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setProgress('running')
    setError('')
    try {
      const normalizedTenantId = tenantId.trim() || DEFAULT_TENANT_ID
      setTenantId(normalizedTenantId)
      const response = await fetch('/api/onboarding/customer/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: normalizedTenantId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '部署失败')
      setResult(body)
      setState(current => current
        ? {
          ...current,
          deploy_status: body.deploy_status,
          deploy_status_path: body.deploy_status_path,
          vault_tree: body.vault_tree,
        }
        : current)
      setProgress('success')
    } catch (err: any) {
      setError(err?.message || '部署失败')
      setProgress('failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="h-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="border-b border-border pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P6 / OB-S4</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal">new-tenant + Docker 部署</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                P6 创建客户工作区，生成 container 状态和 vault 框架；P5 签字文件只作为左侧前置条件。
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-primary">P6 Container</span>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-primary">P6 Vault 框架</span>
                <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">P7 SOUL/AGENTS</span>
                <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">P9 Skills</span>
                <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">Recall 监控</span>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/overview">返回 MC 主页面</Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(300px,0.52fr)_minmax(0,1.48fr)]">
          <form onSubmit={deploy} className="space-y-5 rounded-lg border border-border bg-card p-5">
            <div>
              <label className="text-sm font-medium" htmlFor="tenant-id">Tenant ID</label>
              <div className="mt-2 flex gap-2">
                <input
                  id="tenant-id"
                  value={tenantId}
                  onChange={(event) => {
                    setTenantId(event.target.value)
                    setState(null)
                    setResult(null)
                    setProgress('pending')
                    setError('')
                  }}
                  required
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  placeholder="edu-luolaoshi-v1"
                />
                <Button type="button" variant="outline" onClick={() => loadState()} disabled={loading}>
                  {loading ? '读取中...' : '读取'}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">部署操作者：{username}</p>
            </div>

            {state && (
              <div className={`space-y-2 rounded-md border px-3 py-3 text-sm ${state.confirmation_exists ? 'border-primary/40 bg-primary/10' : 'border-amber-500/35 bg-amber-500/10'}`}>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">前置条件</div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground">P5 签字文件</span>
                  <span className={state.confirmation_exists ? 'text-primary' : 'text-destructive'}>
                    {state.confirmation_exists ? '已找到' : '缺失'}
                  </span>
                </div>
                <div className="break-all text-xs text-muted-foreground">{state.confirmation_path}</div>
                <p className="text-xs text-muted-foreground">
                  这里通过后，P6 才能触发。
                </p>
              </div>
            )}

            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {(['pending', 'running', 'success', 'failed'] as Progress[]).map(step => (
                <div
                  key={step}
                  className={`rounded-md border px-2 py-2 ${
                    progress === step ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  {step}
                </div>
              ))}
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {result?.already_deployed && (
              <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
                deploy-status.json 已存在，本次部署未重启 tenant。
              </div>
            )}

            <Button type="submit" disabled={loading || !state?.confirmation_exists} className="w-full">
              {progress === 'running' ? '部署中...' : '触发 new-tenant + Docker 部署'}
            </Button>
          </form>

          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">部署结果</h2>
                <p className="mt-1 text-sm text-muted-foreground">左侧触发后，这里展示 container 和 vault 框架。</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${deploymentReady ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                {deployStatusLabel}
              </span>
            </div>

            <div className="mt-4 space-y-4">
              {deployStatus ? (
                <div className="rounded-md border border-border bg-background p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Container 关键信息</h3>
                      <p className="mt-1 text-xs text-muted-foreground">P6 生成</p>
                    </div>
                    <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                      {deployDisplay.statusLabel}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <KeyInfo label="容器名" value={deployDisplay.containerName} highlight />
                    <KeyInfo label="运行方式" value={deployDisplay.modeLabel} />
                    <KeyInfo label="完成时间" value={formatDeployTime(deployStatus.deployed_at)} />
                    <KeyInfo label="Vault 初始化" value={vaultReady ? '已完成' : '未完成'} highlight={vaultReady} />
                    <KeyInfo label="状态文件" value={state?.deploy_status_path || result?.deploy_status_path || '未生成'} />
                    <KeyInfo label="下一节点" value={vaultReady && hasVaultTree ? 'P7 可继续' : '停在 P6'} highlight={vaultReady && hasVaultTree} />
                  </div>
                  {deployDisplay.notice && (
                    <div className="mt-4 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-950">
                      {deployDisplay.notice}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-amber-500/35 bg-amber-500/10 p-4">
                  <h3 className="text-sm font-semibold text-amber-300">还没有部署结果</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    左侧前置条件满足后，点“触发 new-tenant + Docker 部署”，这里会显示 container 和 vault 框架。
                  </p>
                </div>
              )}

              <div className="rounded-md border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Vault 整体目录</h3>
                    <p className="mt-1 text-xs text-muted-foreground">蓝色是目录，绿色是文件；文件右侧只标 P 几，只有 P6 文件会显示查看。</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${hasVaultTree ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {hasVaultTree ? `${P6_TEMPLATE_DOCS.length} 个 P6 文档` : '空'}
                  </span>
                  </div>

                <div className="mt-3 grid gap-2 rounded-md border border-border bg-card px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">实际位置</div>
                    <div className="mt-1 break-all text-sm font-semibold text-foreground">{tenantVaultRoot}</div>
                  </div>
                  {hasVaultTree && (
                    <Button asChild variant="outline" size="sm" className="h-8 px-3 text-xs">
                      <Link href={vaultFileHref(activeTenantId, 'vault')}>查看</Link>
                    </Button>
                  )}
                </div>

                {hasVaultTree ? (
                  <div className="mt-4 overflow-hidden rounded-md border border-border bg-card">
                    <VaultTreeRow
                      node={{ path: 'vault', name: 'vault', type: 'directory', children: vaultTree }}
                      tenantId={activeTenantId}
                    />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">部署完成后，这里会显示 vault 目录树。</p>
                )}
                <div className="mt-3 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                  P6 文档都是模板复制类；模板管理位置：<span className="break-all font-semibold text-foreground">{VAULT_TEMPLATE_SOURCE}</span>
                </div>
              </div>

              <details className="rounded-md border border-border bg-background p-4">
                <summary className="cursor-pointer text-sm font-semibold">技术细节（需要排查时再看）</summary>
                <div className="mt-4 space-y-4">
                  {deployStatus && (
                    <div>
                      <h3 className="text-sm font-semibold">container / deploy-status.json</h3>
                      <div className="mt-3 break-all text-sm text-primary">{deployDisplay.containerName}</div>
                      <pre className="mt-3 max-h-72 overflow-auto rounded-md border border-border bg-card p-3 text-xs leading-relaxed">
                        {JSON.stringify({ ...deployStatus, container: deployDisplay.containerName }, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}
