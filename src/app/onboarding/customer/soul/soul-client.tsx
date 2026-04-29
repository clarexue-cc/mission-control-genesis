'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

interface SoulState {
  ok: boolean
  tenant_id: string
  analysis_path: string
  analysis_exists: boolean
  analysis_preview: string
  paths: { soul: string; agents: string }
  content: { soul: string | null; agents: string | null }
  soul_exists: boolean
  agents_exists: boolean
  mode: string | null
  unresolved_placeholders: string[]
  content_hashes: { soul: string | null; agents: string | null }
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

const DEFAULT_TENANT_ID = 'media-intel-v1'

function previewText(value: string | null | undefined, maxLines = 20): string {
  return (value || '').split('\n').slice(0, maxLines).join('\n')
}

function joinDiff(diff: SoulResult['diff_vs_template'] | null): string {
  if (!diff) return ''
  return [
    '# SOUL.md diff',
    diff.soul || '+ (no SOUL diff)',
    '',
    '# AGENTS.md diff',
    diff.agents || '+ (no AGENTS diff)',
  ].join('\n')
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
  const mode = result?.mode || state?.mode || null
  const placeholders = result?.unresolved_placeholders || state?.unresolved_placeholders || []
  const diffPreview = useMemo(() => joinDiff(result?.diff_vs_template || null), [result])

  async function loadState(nextTenantId = tenantId) {
    const normalizedTenantId = nextTenantId.trim() || DEFAULT_TENANT_ID
    setTenantId(normalizedTenantId)
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/onboarding/customer/soul?tenant_id=${encodeURIComponent(normalizedTenantId)}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '读取 OB-S5 状态失败')
      setState(body)
      setResult(null)
      setProgress(body.soul_exists && body.agents_exists ? 'success' : 'pending')
    } catch (err: any) {
      setError(err?.message || '读取 OB-S5 状态失败')
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
          content: body.content,
          paths: body.paths,
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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="border-b border-border pb-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P7 / OB-S5</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal">SOUL / AGENTS 生成</h1>
            </div>
            <div className="flex items-center gap-2">
              {mode && (
                <span className="rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                  {mode}
                </span>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/">返回 MC 主页面</Link>
              </Button>
            </div>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            基于 vault/intake-analysis.md 生成 Agent-Main 的 SOUL.md 与 AGENTS.md，并检查占位符残留。
          </p>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(300px,0.52fr)_minmax(0,1.48fr)]">
          <form onSubmit={generate} className="space-y-5 rounded-lg border border-border bg-card p-5">
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
              <p className="mt-1 text-xs text-muted-foreground">生成操作者：{username}</p>
            </div>

            {state && (
              <div className="space-y-2 rounded-md border border-border bg-background px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">intake-analysis.md</span>
                  <span className={state.analysis_exists ? 'text-primary' : 'text-destructive'}>
                    {state.analysis_exists ? '已找到' : '缺失'}
                  </span>
                </div>
                <div className="break-all text-xs text-muted-foreground">{state.analysis_path}</div>
              </div>
            )}

            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {(['pending', 'generating', 'success', 'failed'] as Progress[]).map(step => (
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

            {result?.already_exists && (
              <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
                SOUL.md 与 AGENTS.md 已存在，本次生成未覆盖原文件。
              </div>
            )}

            <div className={`rounded-md border px-3 py-3 text-sm ${
              placeholders.length > 0 ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-primary/40 bg-primary/10 text-primary'
            }`}>
              占位符残留：{placeholders.length}
              {placeholders.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {placeholders.map(item => (
                    <span key={item} className="rounded-md border border-destructive/40 px-2 py-1 text-xs">{`{{${item}}}`}</span>
                  ))}
                </div>
              )}
            </div>

            <Button type="submit" disabled={loading || !state?.analysis_exists} className="w-full">
              {progress === 'generating' ? '生成中...' : '生成 SOUL/AGENTS'}
            </Button>
          </form>

          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">生成结果</h2>
                <p className="mt-1 text-xs text-muted-foreground">输出目录：phase0/tenants/&lt;tenant&gt;/vault/Agent-Main/</p>
              </div>
              {mode && <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">{mode}</span>}
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-md border border-border bg-background p-4">
                <h3 className="text-sm font-semibold">intake-analysis.md 摘要</h3>
                {state?.analysis_preview ? (
                  <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {previewText(state.analysis_preview, 16)}
                  </pre>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">尚未读取到 intake-analysis.md。请先完成 OB-S2 分析。</p>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-border bg-background p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">SOUL.md</h3>
                    <span className="break-all text-[11px] text-muted-foreground">{result?.paths.soul || state?.paths.soul}</span>
                  </div>
                  {soulContent ? (
                    <textarea
                      value={soulContent}
                      readOnly
                      className="mt-3 h-96 w-full resize-y rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed text-muted-foreground outline-none"
                    />
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">生成后显示 SOUL.md。</p>
                  )}
                </div>

                <div className="rounded-md border border-border bg-background p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">AGENTS.md</h3>
                    <span className="break-all text-[11px] text-muted-foreground">{result?.paths.agents || state?.paths.agents}</span>
                  </div>
                  {agentsContent ? (
                    <textarea
                      value={agentsContent}
                      readOnly
                      className="mt-3 h-96 w-full resize-y rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed text-muted-foreground outline-none"
                    />
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">生成后显示 AGENTS.md。</p>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-border bg-background p-4">
                <h3 className="text-sm font-semibold">diff vs template</h3>
                {diffPreview ? (
                  <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-primary">
                    {diffPreview}
                  </pre>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">生成后显示 template baseline 到实际内容的新增行。</p>
                )}
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}
