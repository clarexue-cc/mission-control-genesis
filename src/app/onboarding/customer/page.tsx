'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

interface UploadResult {
  ok: boolean
  tenant_id: string
  path: string
  content: string
}

const MAX_BYTES = 100 * 1024 * 1024

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function CustomerOnboardingPage() {
  const [tenantId, setTenantId] = useState('demo-dry-run-2')
  const [tenantName, setTenantName] = useState('demo-dry-run-2 客户接入')
  const [summary, setSummary] = useState('demo-dry-run-2：客户访谈材料上传验证。')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fileStatus = useMemo(() => {
    if (!file) return '支持 audio/* 与 text/*，最大 100MB'
    return `${file.name} · ${formatBytes(file.size)} · ${file.type || 'unknown'}`
  }, [file])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResult(null)

    if (!file) {
      setError('请先选择访谈文件')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('文件超过 100MB，请压缩后重新上传')
      return
    }

    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.set('tenant_id', tenantId)
      formData.set('tenant_name', tenantName)
      formData.set('summary', summary)
      formData.set('file', file)

      const response = await fetch('/api/onboarding/customer/intake', {
        method: 'POST',
        body: formData,
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '上传失败')
      setResult(body)
    } catch (err: any) {
      setError(err?.message || '上传失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="border-b border-border pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P3 / OB-S1</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal">新客户接入：上传访谈记录</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                将访谈文稿或录音写入当前 tenant vault 的 intake-raw.md，供后续 OB-S2 分析使用。
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
              <input
                id="tenant-id"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                required
                className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder="edu-luolaoshi-v1"
              />
              <p className="mt-1 text-xs text-muted-foreground">小写字母、数字、连字符。</p>
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="tenant-name">Tenant 名称</label>
              <input
                id="tenant-name"
                value={tenantName}
                onChange={(event) => setTenantName(event.target.value)}
                className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder="罗老师教育助手"
              />
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="summary">用户输入摘要</label>
              <textarea
                id="summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                className="mt-2 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder="记录客户原话、正反例、禁区、渠道、预算等摘要。"
              />
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="intake-file">上传访谈文件</label>
              <label
                htmlFor="intake-file"
                className="mt-2 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center hover:border-primary"
              >
                <span className="text-sm font-medium">拖拽或点击上传</span>
                <span className="mt-2 text-xs text-muted-foreground">{fileStatus}</span>
              </label>
              <input
                id="intake-file"
                type="file"
                accept="audio/*,text/*,.md,.txt"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                required
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? '上传中...' : '确认上传，生成 intake-raw.md'}
            </Button>
          </form>

          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">intake-raw.md 预览</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  输出文件：phase0/tenants/&lt;tenant&gt;/vault/intake-raw.md
                </p>
              </div>
              {result && <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">生成成功</span>}
            </div>

            {result ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  {result.path}
                </div>
                <Button asChild size="sm">
                  <Link href={`/onboarding/customer/analyze?tenant=${encodeURIComponent(result.tenant_id)}`}>
                    进入 P4 客户蓝图生成
                  </Link>
                </Button>
                <pre className="max-h-[640px] overflow-auto rounded-md border border-border bg-background p-4 text-xs leading-relaxed">
                  {result.content}
                </pre>
              </div>
            ) : (
              <div className="mt-4 flex min-h-[420px] items-center justify-center rounded-md border border-border bg-background px-4 text-center text-sm text-muted-foreground">
                上传成功后，这里会显示生成的 Markdown 内容。
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  )
}
