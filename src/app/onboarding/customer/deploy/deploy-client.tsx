'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

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

function flattenTree(nodes: VaultTreeNode[], depth = 0): string[] {
  return nodes.flatMap(node => [
    `${'  '.repeat(depth)}${node.type === 'directory' ? '[dir]' : '[file]'} ${node.name}`,
    ...flattenTree(node.children || [], depth + 1),
  ])
}

export function CustomerDeployClient({ username }: { username: string }) {
  const [tenantId, setTenantId] = useState('demo-dry-run-2')
  const [state, setState] = useState<DeployState | null>(null)
  const [result, setResult] = useState<DeployResult | null>(null)
  const [progress, setProgress] = useState<Progress>('pending')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const treeLines = useMemo(() => flattenTree(result?.vault_tree || state?.vault_tree || []), [result, state])
  const deployStatus = result?.deploy_status || state?.deploy_status || null

  async function loadState(nextTenantId = tenantId) {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/onboarding/customer/deploy?tenant_id=${encodeURIComponent(nextTenantId)}`)
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
    loadState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function deploy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setProgress('running')
    setError('')
    try {
      const response = await fetch('/api/onboarding/customer/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId }),
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
    <main className="min-h-screen overflow-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="border-b border-border pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">OB-S4</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">new-tenant + Docker 部署</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            基于 Clare 签字确认创建 tenant 目录、初始化 vault，并在 Docker 不可用时写入 mock fallback deploy-status.json。
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
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
              <div className="space-y-2 rounded-md border border-border bg-background px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">confirmation-cc.md</span>
                  <span className={state.confirmation_exists ? 'text-primary' : 'text-destructive'}>
                    {state.confirmation_exists ? '已找到' : '缺失'}
                  </span>
                </div>
                <div className="break-all text-xs text-muted-foreground">{state.confirmation_path}</div>
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
                <p className="mt-1 text-xs text-muted-foreground">输出目录：phase0/tenants/&lt;tenant&gt;/</p>
              </div>
              {deployStatus && <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">{deployStatus.status}</span>}
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-md border border-border bg-background p-4">
                <h3 className="text-sm font-semibold">confirmation-cc.md 摘要</h3>
                {state?.confirmation_preview ? (
                  <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {state.confirmation_preview}
                  </pre>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">尚未读取到 confirmation-cc.md。请先完成 OB-S3 签字。</p>
                )}
              </div>

              {deployStatus && (
                <div className="rounded-md border border-border bg-background p-4">
                  <h3 className="text-sm font-semibold">container</h3>
                  <div className="mt-3 break-all text-sm text-primary">{deployStatus.container}</div>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-md border border-border bg-card p-3 text-xs leading-relaxed">
                    {JSON.stringify(deployStatus, null, 2)}
                  </pre>
                </div>
              )}

              <div className="rounded-md border border-border bg-background p-4">
                <h3 className="text-sm font-semibold">vault 目录树</h3>
                {treeLines.length > 0 ? (
                  <pre className="mt-3 max-h-72 overflow-auto text-xs leading-relaxed text-muted-foreground">
                    {treeLines.join('\n')}
                  </pre>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">部署完成后，这里会显示 vault 目录树。</p>
                )}
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}
