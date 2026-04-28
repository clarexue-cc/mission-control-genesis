'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

interface ConfirmState {
  ok: boolean
  tenant_id: string
  intake_raw_path: string
  intake_raw_exists: boolean
  intake_raw_hash: string | null
  intake_raw_preview: string
  confirmation_path: string
  confirmation_exists: boolean
  content: string | null
}

interface ConfirmResult {
  ok: boolean
  tenant_id: string
  path: string
  content: string
  already_exists: boolean
  intake_raw_hash: string
  message: string
}

const DEFAULT_CONFIRMATION_TEXT = 'Clare 已审阅 intake-raw.md，确认开始 tenant 部署。'
const DEFAULT_TENANT_ID = 'media-intel-v1'

export function CustomerConfirmClient({ username }: { username: string }) {
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [confirmationText, setConfirmationText] = useState(DEFAULT_CONFIRMATION_TEXT)
  const [state, setState] = useState<ConfirmState | null>(null)
  const [result, setResult] = useState<ConfirmResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const previewLines = useMemo(() => {
    if (!state?.intake_raw_preview) return []
    return state.intake_raw_preview.split('\n').slice(0, 18)
  }, [state])

  async function loadState(nextTenantId = tenantId) {
    const normalizedTenantId = nextTenantId.trim() || DEFAULT_TENANT_ID
    setTenantId(normalizedTenantId)
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/onboarding/customer/confirm?tenant_id=${encodeURIComponent(normalizedTenantId)}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '读取 OB-S3 状态失败')
      setState(body)
      if (body.confirmation_exists && body.content) {
        setResult({
          ok: true,
          tenant_id: body.tenant_id,
          path: body.confirmation_path,
          content: body.content,
          already_exists: true,
          intake_raw_hash: body.intake_raw_hash || '',
          message: 'confirmation-cc.md already exists; not overwritten',
        })
      } else {
        setResult(null)
      }
    } catch (err: any) {
      setError(err?.message || '读取 OB-S3 状态失败')
      setState(null)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    loadState(params.get('tenant') || params.get('tenant_id') || DEFAULT_TENANT_ID)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const normalizedTenantId = tenantId.trim() || DEFAULT_TENANT_ID
      setTenantId(normalizedTenantId)
      const response = await fetch('/api/onboarding/customer/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: normalizedTenantId,
          confirmation_text: confirmationText,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '签字确认失败')
      setResult(body)
      setState((current) => current
        ? {
          ...current,
          confirmation_exists: true,
          confirmation_path: body.path,
          content: body.content,
          intake_raw_hash: body.intake_raw_hash,
        }
        : current)
    } catch (err: any) {
      setError(err?.message || '签字确认失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen overflow-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="border-b border-border pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P4 / OB-S3</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal">Clare 审阅确认</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                阅读已上传的 intake-raw.md，签字后生成 vault/confirmation-cc.md，作为 P5 人工确认节点。
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/">返回 MC 主页面</Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-card p-5">
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
              <p className="mt-1 text-xs text-muted-foreground">签字人：{username}</p>
            </div>

            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              待补：vault/intake-analysis.md（OB-S2 后续 PR 实现）。本轮 S3 只验证 OB-S1 产出的 intake-raw.md。
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="confirmation-text">确认语</label>
              <textarea
                id="confirmation-text"
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                className="mt-2 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            {state && (
              <div className="space-y-2 rounded-md border border-border bg-background px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">intake-raw.md</span>
                  <span className={state.intake_raw_exists ? 'text-primary' : 'text-destructive'}>
                    {state.intake_raw_exists ? '已找到' : '缺失'}
                  </span>
                </div>
                <div className="break-all text-xs text-muted-foreground">{state.intake_raw_path}</div>
                {state.intake_raw_hash && (
                  <div className="break-all text-xs text-muted-foreground">sha256: {state.intake_raw_hash}</div>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {result?.already_exists && (
              <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
                confirmation-cc.md 已存在，本次签字未覆盖旧文件。
              </div>
            )}

            <Button type="submit" disabled={submitting || loading || !state?.intake_raw_exists} className="w-full">
              {submitting ? '签字中...' : 'Clare 已审阅，确认开始 tenant 部署'}
            </Button>
          </form>

          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">OB-S3 文件预览</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  输出文件：phase0/tenants/&lt;tenant&gt;/vault/confirmation-cc.md
                </p>
              </div>
              {result && (
                <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                  {result.already_exists ? '已存在' : '签字完成'}
                </span>
              )}
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-md border border-border bg-background p-4">
                <h3 className="text-sm font-semibold">intake-raw.md 摘要</h3>
                {previewLines.length > 0 ? (
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {previewLines.join('\n')}
                  </pre>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">尚未读取到 intake-raw.md。请先完成 OB-S1 上传。</p>
                )}
              </div>

              {result ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                    {result.path}
                  </div>
                  <pre className="max-h-[520px] overflow-auto rounded-md border border-border bg-background p-4 text-xs leading-relaxed">
                    {result.content}
                  </pre>
                </div>
              ) : (
                <div className="flex min-h-[300px] items-center justify-center rounded-md border border-border bg-background px-4 text-center text-sm text-muted-foreground">
                  签字成功后，这里会显示 confirmation-cc.md 内容。
                </div>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}
