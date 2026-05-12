'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

interface P7FileInfo {
  name: string
  display_name: string
  relative_path: string
  exists: boolean
  size_bytes: number
}

interface P7FilesData {
  total: number
  exists_count: number
  missing_count: number
  files: P7FileInfo[]
}

interface SoulState {
  ok: boolean
  tenant_id: string
  analysis_path: string
  analysis_exists: boolean
  analysis_preview: string
  paths: { soul: string; agents: string; memory: string; boundary: string }
  content: { soul: string | null; agents: string | null; memory: string | null; boundary: string | null }
  soul_exists: boolean
  agents_exists: boolean
  memory_exists: boolean
  boundary_exists: boolean
  mode: string | null
  unresolved_placeholders: string[]
  content_hashes: { soul: string | null; agents: string | null }
  p7_files?: P7FilesData
}

interface SoulResult {
  ok: boolean
  tenant_id: string
  paths: { soul: string; agents: string }
  content: { soul: string; agents: string }
  mode: string
  provider: string
  already_exists: boolean
  diff_vs_template: { soul: string; agents: string }
  unresolved_placeholders: string[]
  content_hashes: { soul: string; agents: string }
}

type Progress = 'pending' | 'generating' | 'success' | 'failed'

const DEFAULT_TENANT_ID = resolveDefaultCustomerTenantId()

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function StatusBadge({ exists, label }: { exists: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
      exists
        ? 'border border-primary/40 bg-primary/15 text-primary'
        : 'border border-destructive/40 bg-destructive/15 text-destructive'
    }`}>
      {exists ? '✅' : '❌'} {label}
    </span>
  )
}

/** 全宽文档查看区 */
function DocSection({ title, path, content, exists, placeholder }: {
  title: string
  path?: string
  content: string
  exists: boolean
  placeholder: string
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <StatusBadge exists={exists} label={exists ? formatBytes(new Blob([content]).size) : '缺失'} />
        </div>
        {path && <span className="text-xs text-muted-foreground break-all">{path}</span>}
      </div>
      <div className="p-6">
        {content ? (
          <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground/90 max-h-[70vh] overflow-auto">
            {content}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">{placeholder}</p>
        )}
      </div>
    </section>
  )
}

export function CustomerSoulClient({ username }: { username: string }) {
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [state, setState] = useState<SoulState | null>(null)
  const [result, setResult] = useState<SoulResult | null>(null)
  const [progress, setProgress] = useState<Progress>('pending')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const soulContent = result?.content.soul || state?.content.soul || ''
  const agentsContent = result?.content.agents || state?.content.agents || ''
  const memoryContent = state?.content.memory || ''
  const boundaryContent = state?.content.boundary || ''
  const mode = result?.mode || state?.mode || null
  const placeholders = result?.unresolved_placeholders || state?.unresolved_placeholders || []

  async function loadState(nextTenantId = tenantId) {
    const normalizedTenantId = nextTenantId.trim() || DEFAULT_TENANT_ID
    setTenantId(normalizedTenantId)
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/onboarding/customer/soul?tenant_id=${encodeURIComponent(normalizedTenantId)}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '读取状态失败')
      setState(body)
      setResult(null)
      setProgress(body.soul_exists && body.agents_exists ? 'success' : 'pending')
    } catch (err: any) {
      setError(err?.message || '读取状态失败')
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

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setProgress('generating')
    setError('')
    try {
      const normalizedTenantId = tenantId.trim() || DEFAULT_TENANT_ID
      setTenantId(normalizedTenantId)
      const response = await fetch('/api/onboarding/customer/soul', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: normalizedTenantId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'SOUL/AGENTS 生成失败')
      setResult(body)
      setState(current => current
        ? {
          ...current,
          content: { ...current.content, soul: body.content.soul, agents: body.content.agents },
          paths: { ...current.paths, soul: body.paths.soul, agents: body.paths.agents },
          soul_exists: true,
          agents_exists: true,
          mode: body.mode,
          unresolved_placeholders: body.unresolved_placeholders,
          content_hashes: body.content_hashes,
        }
        : current)
      setProgress('success')
    } catch (err: any) {
      setError(err?.message || 'SOUL/AGENTS 生成失败')
      setProgress('failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="h-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8">

        {/* ── 页头 + 控制栏 ── */}
        <header className="border-b border-border pb-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P7</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal">核心文档定稿</h1>
            </div>
            <div className="flex items-center gap-3">
              {state?.p7_files && (
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  state.p7_files.missing_count === 0
                    ? 'border border-primary/40 bg-primary/15 text-primary'
                    : 'border border-yellow-500/40 bg-yellow-500/15 text-yellow-600'
                }`}>
                  {state.p7_files.exists_count}/{state.p7_files.total} 就绪
                </span>
              )}
              {mode && (
                <span className="rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                  {mode}
                </span>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/">返回 MC</Link>
              </Button>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            P7 定稿的 4 个核心文档：SOUL（身份定义）、AGENTS（操作系统）、MEMORY（记忆索引）、Boundary（红线配置）。逐个确认内容后进入 P8。
          </p>
        </header>

        {/* ── 操作面板（紧凑） ── */}
        <section className="rounded-lg border border-border bg-card p-5">
          <form onSubmit={generate} className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium" htmlFor="tenant-id">Tenant ID</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="tenant-id"
                  value={tenantId}
                  onChange={(e) => { setTenantId(e.target.value); setState(null); setResult(null); setProgress('pending'); setError('') }}
                  required
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <Button type="button" variant="outline" onClick={() => loadState()} disabled={loading}>
                  {loading ? '读取中...' : '读取'}
                </Button>
              </div>
            </div>
            {state && (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">intake-analysis.md</span>
                <span className={state.analysis_exists ? 'text-primary font-medium' : 'text-destructive font-medium'}>
                  {state.analysis_exists ? '✅ 已找到' : '❌ 缺失'}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              {placeholders.length > 0 && (
                <span className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                  占位符残留：{placeholders.length}
                </span>
              )}
              <Button type="submit" disabled={loading || !state?.analysis_exists}>
                {progress === 'generating' ? '生成中...' : '生成 SOUL/AGENTS'}
              </Button>
            </div>
          </form>
          {error && (
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {result?.already_exists && (
            <div className="mt-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
              SOUL.md 与 AGENTS.md 已存在，本次未覆盖原文件。
            </div>
          )}
        </section>

        {/* ── P7 文件状态一览 ── */}
        {state?.p7_files && (
          <div className="flex flex-wrap gap-3">
            {state.p7_files.files.map(f => (
              <StatusBadge key={f.name} exists={f.exists} label={`${f.display_name}${f.exists ? ` (${formatBytes(f.size_bytes)})` : ''}`} />
            ))}
          </div>
        )}

        {/* ── SOUL.md 全宽 ── */}
        <DocSection
          title="SOUL.md — 身份定义"
          path={state?.paths.soul}
          content={soulContent}
          exists={state?.soul_exists ?? false}
          placeholder="尚未生成 SOUL.md。请先完成 intake-analysis 后点击「生成 SOUL/AGENTS」。"
        />

        {/* ── AGENTS.md 全宽 ── */}
        <DocSection
          title="AGENTS.md — 操作系统"
          path={state?.paths.agents}
          content={agentsContent}
          exists={state?.agents_exists ?? false}
          placeholder="尚未生成 AGENTS.md。"
        />

        {/* ── MEMORY.md 全宽 ── */}
        <DocSection
          title="MEMORY.md — 记忆索引"
          path={state?.paths.memory}
          content={memoryContent}
          exists={state?.memory_exists ?? false}
          placeholder="尚未创建 MEMORY.md。P7 阶段需要初始化记忆索引。"
        />

        {/* ── boundary-rules.json 全宽 ── */}
        <DocSection
          title="boundary-rules.json — 红线配置"
          path={state?.paths.boundary}
          content={boundaryContent}
          exists={state?.boundary_exists ?? false}
          placeholder="尚未创建 boundary-rules.json。P7 阶段需要从蓝图红线生成 JSON 配置。"
        />

      </div>
    </main>
  )
}
