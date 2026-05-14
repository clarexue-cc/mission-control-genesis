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

interface OpenclawAgent {
  id: string
  name: string
  default?: boolean
  workspace?: string
  systemPromptFile?: string
}

interface OpenclawConfig {
  meta?: { tenant_id?: string; tenant_name?: string; template?: string; agent_pattern?: string }
  platform?: { base?: string; version?: string; build?: string; harness?: string }
  agents?: { defaults?: { model?: { primary?: string; strategy?: string; note?: string } }; list?: OpenclawAgent[] }
  tools?: { allow?: string[]; deny?: string[] }
  channels?: Record<string, { enabled?: boolean; note?: string }>
  gateway?: { port?: number; auth?: { mode?: string } }
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
  workspace_tree: VaultTreeNode[]
  openclaw_config: OpenclawConfig | null
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
  workspace_tree: VaultTreeNode[]
  openclaw_config: OpenclawConfig | null
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
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fileViewHref(tenantId: string, logicalPath: string) {
  return `/onboarding/customer/vault-file?tenant=${encodeURIComponent(tenantId)}&path=${encodeURIComponent(logicalPath)}`
}

function KeyInfo({ label, value, highlight = false, href, action }: { label: string; value: string; highlight?: boolean; href?: string; action?: string }) {
  const inner = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 break-words text-sm font-semibold ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</div>
      {(href || action) && <div className="mt-1.5 text-[10px] font-medium text-primary">{action || '点击查看 →'}</div>}
    </>
  )
  if (href) {
    return (
      <Link href={href} className={`block rounded-md border px-3 py-3 transition hover:border-primary ${highlight ? 'border-primary/40 bg-primary/10' : 'border-border bg-background'}`}>
        {inner}
      </Link>
    )
  }
  return (
    <div className={`rounded-md border px-3 py-3 ${highlight ? 'border-primary/40 bg-primary/10' : 'border-border bg-background'}`}>
      {inner}
    </div>
  )
}

function VaultTreeLine({ icon, name, label, phase, indent = 0, last = false, href }: {
  icon: string; name: string; label: string; phase: string
  indent?: number; last?: boolean; href?: string
}) {
  const prefix = indent === 0 ? '' : '│   '.repeat(indent - 1) + (last ? '└── ' : '├── ')
  const done = phase.startsWith('✅')
  const pending = phase.startsWith('⏳')
  const phaseColor = done ? 'text-primary' : pending ? 'text-amber-500' : 'text-muted-foreground'
  return (
    <div className="flex items-baseline gap-0">
      <span className="text-muted-foreground/50 select-none whitespace-pre">{prefix}</span>
      <span>{icon} </span>
      {href ? (
        <Link href={href} className="font-semibold text-foreground underline decoration-muted-foreground/30 hover:decoration-primary">{name}</Link>
      ) : (
        <span className="font-semibold text-foreground">{name}</span>
      )}
      {label && <span className="ml-2 font-sans text-muted-foreground">— {label}</span>}
      <span className={`ml-auto shrink-0 font-sans text-[11px] ${phaseColor}`}>{phase}</span>
    </div>
  )
}

export function CustomerDeployClient({ username }: { username: string }) {
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [state, setState] = useState<DeployState | null>(null)
  const [result, setResult] = useState<DeployResult | null>(null)
  const [progress, setProgress] = useState<Progress>('pending')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showEvidence, setShowEvidence] = useState(false)

  const vaultTree = result?.vault_tree || state?.vault_tree || []
  const workspaceTree = result?.workspace_tree || state?.workspace_tree || []
  const openclawConfig = result?.openclaw_config || state?.openclaw_config || null
  const deployStatus = result?.deploy_status || state?.deploy_status || null
  const vaultReady = deployStatus?.vault_initialized === true
  const hasVaultTree = vaultTree.length > 0
  const hasWorkspaceTree = workspaceTree.length > 0
  const deploymentReady = Boolean(deployStatus)
  const isMockMode = deployStatus?.mode === 'mock-fallback'
  const allVaultNodes = useMemo(() => flattenNodes(vaultTree), [vaultTree])
  const allWorkspaceNodes = useMemo(() => flattenNodes(workspaceTree), [workspaceTree])
  const hasVaultPath = (p: string) => allVaultNodes.some(n => n.path === p)
  const hasWorkspacePath = (p: string) => allWorkspaceNodes.some(n => n.path === p)
  const activeTenantId = result?.tenant_id || state?.tenant_id || tenantId
  const deployDisplay = getCustomerDeployStatusDisplay(deployStatus, activeTenantId)
  const deployStatusLabel = deploymentReady ? deployDisplay.statusLabel : '等待触发'

  // OpenClaw config display
  const ocAgent = openclawConfig?.agents?.list?.[0]
  const ocVersion = openclawConfig?.platform?.version
  const ocBuild = openclawConfig?.platform?.build
  const ocModelStrategy = openclawConfig?.agents?.defaults?.model?.strategy || (openclawConfig?.agents?.defaults?.model?.primary ? 'global' : undefined)
  const ocTools = openclawConfig?.tools?.allow || []
  const ocTemplate = openclawConfig?.meta?.template

  async function loadState(nextTenantId = tenantId) {
    const normalizedTenantId = nextTenantId.trim() || DEFAULT_TENANT_ID
    setTenantId(normalizedTenantId)
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/onboarding/customer/deploy?tenant_id=${encodeURIComponent(normalizedTenantId)}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '读取部署状态失败')
      setState(body)
      setResult(null)
      setProgress(body.deploy_status ? 'success' : 'pending')
    } catch (err: any) {
      setError(err?.message || '读取部署状态失败')
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
      setState(current => current ? { ...current, deploy_status: body.deploy_status, deploy_status_path: body.deploy_status_path, vault_tree: body.vault_tree, workspace_tree: body.workspace_tree, openclaw_config: body.openclaw_config } : current)
      setProgress('success')
    } catch (err: any) {
      setError(err?.message || '部署失败')
      setProgress('failed')
    } finally {
      setLoading(false)
    }
  }

  const fv = (logicalPath: string) => fileViewHref(activeTenantId, logicalPath)

  return (
    <main className="h-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="border-b border-border pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P6 / OB-S4</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal">Workspace + Vault 部署</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                P6 创建客户完整工作区（workspace + vault + config），验证 P4 蓝图的文件结构全部就位。
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/overview">返回 MC 主页面</Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(300px,0.52fr)_minmax(0,1.48fr)]">
          {/* Left panel */}
          <form onSubmit={deploy} className="space-y-5 rounded-lg border border-border bg-card p-5">
            <div>
              <label className="text-sm font-medium" htmlFor="tenant-id">Tenant ID</label>
              <div className="mt-2 flex gap-2">
                <input id="tenant-id" value={tenantId} onChange={e => { setTenantId(e.target.value); setState(null); setResult(null); setProgress('pending'); setError('') }} required className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" placeholder="wechat-mp-agent" />
                <Button type="button" variant="outline" onClick={() => loadState()} disabled={loading}>{loading ? '读取中...' : '读取'}</Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">操作者：{username}</p>
            </div>

            {state && (
              <div className={`space-y-2 rounded-md border px-3 py-3 text-sm ${state.confirmation_exists ? 'border-primary/40 bg-primary/10' : 'border-amber-500/35 bg-amber-500/10'}`}>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">前置条件</div>
                <div className="flex items-center justify-between gap-3">
                  <span>P5 签字文件</span>
                  <span className={state.confirmation_exists ? 'text-primary' : 'text-destructive'}>{state.confirmation_exists ? '✅ 已找到' : '❌ 缺失'}</span>
                </div>
                <div className="break-all text-xs text-muted-foreground">{state.confirmation_path}</div>
              </div>
            )}

            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {(['pending', 'running', 'success', 'failed'] as Progress[]).map(step => (
                <div key={step} className={`rounded-md border px-2 py-2 ${progress === step ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-background text-muted-foreground'}`}>{step}</div>
              ))}
            </div>

            {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

            <Button type="submit" disabled={loading || !state?.confirmation_exists || progress === 'success'} className="w-full">
              {progress === 'running' ? '部署中...' : progress === 'success' ? '✅ 已部署完成' : '触发部署'}
            </Button>
          </form>

          {/* Right panel */}
          <section className="space-y-4">
            {/* 1. Deploy Status */}
            {deployStatus ? (
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">部署状态</h2>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${isMockMode ? 'bg-primary/15 text-primary' : 'bg-primary/15 text-primary'}`}>
                    {isMockMode ? '✅ 本地部署完成' : deployDisplay.statusLabel}
                  </span>
                </div>

                {isMockMode && (
                  <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">本地开发模式</span> — workspace、vault、config 文件全部已真实创建在本机磁盘上。Docker 容器在给客户交付时才需要，开发阶段不需要。
                  </div>
                )}

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <KeyInfo label="容器名" value={deployDisplay.containerName} highlight={!isMockMode} />
                  <KeyInfo label="运行方式" value={isMockMode ? '本地开发（交付时打包 Docker）' : deployDisplay.modeLabel} />
                  <KeyInfo label="完成时间" value={formatDeployTime(deployStatus.deployed_at)} />
                  <KeyInfo label="Vault 初始化" value={vaultReady ? '✅ 已完成' : '未完成'} highlight={vaultReady} href={vaultReady ? fv('vault') : undefined} action="打开 Vault 文件浏览 →" />
                  <KeyInfo label="Workspace" value={hasWorkspaceTree ? '✅ 已创建' : '未创建'} highlight={hasWorkspaceTree} href={hasWorkspaceTree ? fv('workspace') : undefined} action="打开 Workspace 文件浏览 →" />
                  <KeyInfo label="下一步" value={vaultReady && hasVaultTree ? 'P7 可继续' : '停在 P6'} highlight={vaultReady && hasVaultTree} />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-5">
                <h2 className="text-lg font-semibold text-amber-300">还没有部署结果</h2>
                <p className="mt-2 text-sm text-muted-foreground">左侧前置条件满足后，点"触发部署"。</p>
              </div>
            )}

            {/* 1.5 Deploy Evidence — verify the deployment is real */}
            {deployStatus && (
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">部署验证</h2>
                  <button type="button" onClick={() => setShowEvidence(!showEvidence)} className="text-xs text-primary hover:underline">
                    {showEvidence ? '收起原始记录' : '查看原始部署记录 (deploy-status.json)'}
                  </button>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <Link href={fv('vault')} className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2.5 transition hover:border-primary">
                    <span className="text-lg">📂</span>
                    <div>
                      <div className="text-sm font-semibold text-primary">打开 Vault</div>
                      <div className="text-[10px] text-muted-foreground">浏览所有 vault 文件 →</div>
                    </div>
                  </Link>
                  <Link href={fv('workspace')} className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2.5 transition hover:border-primary">
                    <span className="text-lg">📂</span>
                    <div>
                      <div className="text-sm font-semibold text-primary">打开 Workspace</div>
                      <div className="text-[10px] text-muted-foreground">浏览所有 workspace 文件 →</div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5">
                    <span className="text-lg">{isMockMode ? '💻' : '🐳'}</span>
                    <div>
                      <div className="text-sm font-semibold">{isMockMode ? '本地开发模式' : 'Docker 容器'}</div>
                      <div className="text-[10px] text-muted-foreground">{isMockMode ? '文件在本机磁盘，交付时才打包 Docker' : deployDisplay.containerName}</div>
                    </div>
                  </div>
                </div>
                {showEvidence && (
                  <pre className="mt-3 max-h-[40vh] overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed">
                    {JSON.stringify(deployStatus, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* 2. OpenClaw Config */}
            {openclawConfig && (
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">OpenClaw 底座配置</h2>
                    <p className="mt-1 text-xs text-muted-foreground">config/openclaw.json — Agent 运行时引擎</p>
                  </div>
                  <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">✅ 已配置</span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <KeyInfo label="Agent" value={ocAgent ? `${ocAgent.name}（${ocAgent.id}）` : '未配置'} highlight />
                  <KeyInfo label="OC 版本" value={ocVersion ? `${ocVersion}${ocBuild ? ` (${ocBuild})` : ''}` : '未标记'} highlight />
                  <KeyInfo label="模板" value={ocTemplate || '未指定'} />
                  <KeyInfo label="模型策略" value={ocModelStrategy === 'per-skill' ? 'P9 各 Skill 各自配置' : ocModelStrategy === 'global' ? openclawConfig?.agents?.defaults?.model?.primary?.split('/').pop() || '全局' : '待配置'} />
                  <KeyInfo label="允许工具" value={ocTools.join(', ') || '无'} />
                  <KeyInfo label="网关端口" value={String(openclawConfig.gateway?.port || '未配置')} />
                  <KeyInfo label="微信渠道" value={openclawConfig.channels?.wechat?.enabled ? '已启用' : 'P14 配置'} />
                </div>
              </div>
            )}

            {/* 3. Workspace + Vault Tree */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Agent 完整架构 — Workspace + Vault</h2>
                  <p className="mt-1 text-xs text-muted-foreground">与 P4 蓝图一一对应，✅ = 文件已就位，⏳ = 后续阶段创建</p>
                </div>
                <div className="flex gap-2 text-[11px]">
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-primary">✅ 已就位</span>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-500">⏳ 待完成</span>
                </div>
              </div>

              {/* Workspace */}
              <div className="mt-3 rounded border border-border bg-background px-4 py-3 font-mono text-xs leading-[1.9]">
                <div className="font-sans text-[11px] font-semibold text-primary mb-1">① Workspace — 运行环境（每个 Agent 独立一套）</div>
                <VaultTreeLine icon="📂" name={`workspace/`} label={`${activeTenantId} 的运行环境`} phase={hasWorkspaceTree ? '✅ P6 已部署' : '⏳ P6 部署'} />
                <VaultTreeLine icon="💡" name="SOUL.md" label="人格 + 红线" phase="⏳ P7 定稿" indent={1} href={hasWorkspacePath('workspace/SOUL.md') ? fv('workspace/SOUL.md') : undefined} />
                <VaultTreeLine icon="⚙️" name="AGENTS.md" label="操作系统 SOP + workflow" phase="⏳ P7 定稿" indent={1} href={hasWorkspacePath('workspace/AGENTS.md') ? fv('workspace/AGENTS.md') : undefined} />
                <VaultTreeLine icon="🪪" name="IDENTITY.md" label="身份卡" phase={hasWorkspacePath('workspace/IDENTITY.md') ? '✅ 已就位' : '⏳ P4'} indent={1} href={hasWorkspacePath('workspace/IDENTITY.md') ? fv('workspace/IDENTITY.md') : undefined} />
                <VaultTreeLine icon="👤" name="USER.md" label="用户画像" phase={hasWorkspacePath('workspace/USER.md') ? '✅ 已就位' : '⏳ P4'} indent={1} href={hasWorkspacePath('workspace/USER.md') ? fv('workspace/USER.md') : undefined} />
                <VaultTreeLine icon="🧠" name="MEMORY.md" label="记忆索引（醒来先读）" phase="⏳ P7 定稿" indent={1} />
                <VaultTreeLine icon="📄" name="TOOLS.md" label="工具使用规则" phase="⏳ P7 定稿" indent={1} />
                <VaultTreeLine icon="📄" name="HEARTBEAT.md" label="定时任务（每日热点扫描）" phase="⏳ P7 定稿" indent={1} />
                <VaultTreeLine icon="📄" name="PROBLEMS.md" label="已知问题 + 解决方案" phase="⏳ 运行时积累" indent={1} />
                <VaultTreeLine icon="📁" name="skills/" label="7 个 Workspace Skill" phase="⏳ P9 定稿" indent={1} />
                <VaultTreeLine icon="📁" name="daily-trending/" label="" phase="⏳" indent={2} />
                <VaultTreeLine icon="📁" name="content-planner/" label="" phase="⏳" indent={2} />
                <VaultTreeLine icon="📁" name="article-writer/" label="" phase="⏳" indent={2} />
                <VaultTreeLine icon="📁" name="image-generator/" label="" phase="⏳" indent={2} />
                <VaultTreeLine icon="📁" name="cover-generator/" label="" phase="⏳" indent={2} />
                <VaultTreeLine icon="📁" name="markdown-to-html/" label="" phase="⏳" indent={2} />
                <VaultTreeLine icon="📁" name="publish-orchestrator/" label="" phase="⏳" indent={2} last />
                <VaultTreeLine icon="📁" name="drafts/" label="内容工厂（每篇文章一个子目录）" phase="⏳ 运行时产生" indent={1} />
                <VaultTreeLine icon="📁" name="saves/" label="进度存档（3 个网关状态 JSON）" phase="⏳ 运行时填充" indent={1} />
                <VaultTreeLine icon="📄" name="boundary-rules.json" label="边界规则" phase={hasWorkspacePath('workspace/boundary-rules.json') ? '✅ 已就位' : '⏳ P8'} indent={1} href={hasWorkspacePath('workspace/boundary-rules.json') ? fv('workspace/boundary-rules.json') : undefined} />
                <VaultTreeLine icon="📁" name="config/" label="运行时配置" phase={deploymentReady ? '✅ P6 已创建' : '⏳ P6'} indent={1} last />
              </div>

              {/* Vault — matches P4 exactly */}
              <div className="mt-3 rounded border border-border bg-background px-4 py-3 font-mono text-xs leading-[1.9]">
                <div className="font-sans text-[11px] font-semibold text-primary mb-1">② Vault — 记忆系统 / Obsidian 知识库（多 Agent 共享一个 Vault）</div>
                <VaultTreeLine icon="📂" name="vault/" label="Agent 的外部大脑" phase={hasVaultTree ? '✅ P6 已初始化' : '⏳ P6 初始化'} />

                <div className="mt-1 ml-4 mb-1 font-sans text-[11px] text-muted-foreground/70">── 全局导航 ──</div>
                <VaultTreeLine icon="📄" name="00-vault-index.md" label="导航索引" phase={hasVaultPath('vault/00-vault-index.md') ? '✅ 已就位' : '⏳ P4'} indent={1} href={hasVaultPath('vault/00-vault-index.md') ? fv('vault/00-vault-index.md') : undefined} />
                <VaultTreeLine icon="🔐" name="00-permissions.yaml" label="权限矩阵" phase={hasVaultPath('vault/00-permissions.yaml') ? '✅ 已就位' : '⏳ P4'} indent={1} href={hasVaultPath('vault/00-permissions.yaml') ? fv('vault/00-permissions.yaml') : undefined} />

                <div className="mt-1 ml-4 mb-1 font-sans text-[11px] text-muted-foreground/70">── Agent 私有记忆（每个 Agent 一个目录） ──</div>
                <VaultTreeLine icon="📁" name="Agent-公众号/" label="公众号的私有记忆" phase={hasVaultPath('vault/Agent-公众号/working-context.md') ? '✅ 已就位' : '⏳ P4'} indent={1} />
                <VaultTreeLine icon="📄" name="working-context.md" label="上次做到哪了" phase={hasVaultPath('vault/Agent-公众号/working-context.md') ? '✅ 骨架，运行时填充' : '⏳ P4'} indent={2} href={hasVaultPath('vault/Agent-公众号/working-context.md') ? fv('vault/Agent-公众号/working-context.md') : undefined} />
                <VaultTreeLine icon="📄" name="mistakes.md" label="错误学习" phase={hasVaultPath('vault/Agent-公众号/mistakes.md') ? '✅ 骨架，运行时填充' : '⏳ P4'} indent={2} href={hasVaultPath('vault/Agent-公众号/mistakes.md') ? fv('vault/Agent-公众号/mistakes.md') : undefined} />
                <VaultTreeLine icon="📄" name="agent-guide.md" label="公众号专有行为准则" phase={hasVaultPath('vault/Agent-公众号/agent-guide.md') ? '✅ 已就位' : '⏳ P7 生成'} indent={2} href={hasVaultPath('vault/Agent-公众号/agent-guide.md') ? fv('vault/Agent-公众号/agent-guide.md') : undefined} />
                <VaultTreeLine icon="📁" name="daily/" label="日志（按日期）" phase="✅ 空目录，运行时填充" indent={2} />
                <VaultTreeLine icon="📁" name="published/" label="发布档案（标题/链接/数据/复盘）" phase="⏳ 运行时积累" indent={2} last />
                <VaultTreeLine icon="📁" name="Agent-情报搜集/" label="竞对监控、热点追踪、评论挖掘" phase="⏳ 预留" indent={1} />
                <VaultTreeLine icon="📁" name="Agent-选题问答/" label="选题融合、问答框架" phase="⏳ 预留" indent={1} />
                <VaultTreeLine icon="📁" name="Agent-爆款复刻改写/" label="爆款拆解、行业适配改写" phase="⏳ 预留" indent={1} />
                <VaultTreeLine icon="📁" name="Agent-精品深度/" label="深度调研、思维导图、讲课大纲" phase="⏳ 预留" indent={1} />
                <VaultTreeLine icon="📁" name="Agent-数据复盘/" label="11账号数据汇总、爆款归因" phase="⏳ 预留" indent={1} />

                <div className="mt-1 ml-4 mb-1 font-sans text-[11px] text-muted-foreground/70">── 跨 Agent 共享层 ──</div>
                <VaultTreeLine icon="📁" name="Agent-Shared/" label="所有 Agent 共享的知识和规则" phase={hasVaultPath('vault/Agent-Shared/user-profile.md') ? '✅ 已就位' : '⏳ P4'} indent={1} />
                <VaultTreeLine icon="📄" name="user-profile.md" label="用户画像（动态，运行时更新）" phase={hasVaultPath('vault/Agent-Shared/user-profile.md') ? '✅ 骨架，运行时填充' : '⏳ P4'} indent={2} href={hasVaultPath('vault/Agent-Shared/user-profile.md') ? fv('vault/Agent-Shared/user-profile.md') : undefined} />
                <VaultTreeLine icon="📄" name="project-state.md" label="项目进度" phase={hasVaultPath('vault/Agent-Shared/project-state.md') ? '✅ 骨架，运行时填充' : '⏳ P4'} indent={2} href={hasVaultPath('vault/Agent-Shared/project-state.md') ? fv('vault/Agent-Shared/project-state.md') : undefined} />
                <VaultTreeLine icon="📄" name="decisions-log.md" label="决策记录" phase={hasVaultPath('vault/Agent-Shared/decisions-log.md') ? '✅ 骨架，运行时填充' : '⏳ P4'} indent={2} href={hasVaultPath('vault/Agent-Shared/decisions-log.md') ? fv('vault/Agent-Shared/decisions-log.md') : undefined} />
                <VaultTreeLine icon="📄" name="shared-rules.md" label="跨 Agent 规则" phase={hasVaultPath('vault/Agent-Shared/shared-rules.md') ? '✅ 已就位' : '⏳ P4'} indent={2} href={hasVaultPath('vault/Agent-Shared/shared-rules.md') ? fv('vault/Agent-Shared/shared-rules.md') : undefined} />
                <VaultTreeLine icon="📁" name="knowledge/" label="行业知识库" phase="⏳ 运行时积累" indent={2} last />

                <div className="mt-1 ml-4 mb-1 font-sans text-[11px] text-muted-foreground/70">── 短期通信层（Agent 之间传话用） ──</div>
                <VaultTreeLine icon="📁" name="Bulletin/" label="Agent 间短期通信" phase={hasVaultPath('vault/Bulletin') || allVaultNodes.some(n => n.path.startsWith('vault/Bulletin')) ? '✅ 已创建' : '⏳ P4'} indent={1} />
                <VaultTreeLine icon="📁" name="daily-briefing/" label="每日简报" phase="✅ 空目录，运行时填充" indent={2} />
                <VaultTreeLine icon="📁" name="search-findings/" label="搜索发现" phase="✅ 空目录，运行时填充" indent={2} />
                <VaultTreeLine icon="📁" name="alerts/" label="告警" phase="✅ 空目录，运行时填充" indent={2} />
                <VaultTreeLine icon="📁" name="requests/" label="跨 Agent 请求" phase="✅ 空目录，运行时填充" indent={2} last />

                <VaultTreeLine icon="📁" name="Archive/" label="归档区（守护 Agent 管理）" phase="✅ 空目录" indent={1} last />
              </div>
            </div>

            {/* 4. Technical Details */}
            <details className="rounded-lg border border-border bg-card p-5">
              <summary className="cursor-pointer text-sm font-semibold">技术细节（排查时展开）</summary>
              <div className="mt-4 space-y-4">
                {deployStatus && (
                  <div>
                    <h3 className="text-sm font-semibold">deploy-status.json</h3>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed">
                      {JSON.stringify(deployStatus, null, 2)}
                    </pre>
                  </div>
                )}
                {openclawConfig && (
                  <div>
                    <h3 className="text-sm font-semibold">config/openclaw.json</h3>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed">
                      {JSON.stringify(openclawConfig, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          </section>
        </section>
      </div>
    </main>
  )
}
