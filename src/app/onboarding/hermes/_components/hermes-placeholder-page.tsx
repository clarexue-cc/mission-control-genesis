import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface HermesPlaceholderPageProps {
  title: string
  description: string
  pending: string
}

export function HermesPlaceholderPage({ title, description, pending }: HermesPlaceholderPageProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="border-b border-border pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Hermes Build</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal">{title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
            <Link
              href="/"
              className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              返回 MC 主页面
            </Link>
          </div>
        </header>

        <section className="rounded-lg border border-dashed border-muted-foreground/30 bg-card/60 p-8 text-center text-sm text-muted-foreground">
          {pending}
        </section>
      </div>
    </main>
  )
}

interface HermesPageShellProps {
  title: string
  description: string
  kicker?: string
  maxWidth?: string
  children: ReactNode
}

export function HermesPageShell({
  title,
  description,
  kicker = 'Hermes Build',
  maxWidth = 'max-w-6xl',
  children,
}: HermesPageShellProps) {
  return (
    <main className="h-screen overflow-y-auto bg-background text-foreground">
      <div className={`mx-auto flex w-full ${maxWidth} flex-col gap-6 px-6 py-8`}>
        <header className="border-b border-border pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{kicker}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal">{title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/">返回 MC 主页面</Link>
            </Button>
          </div>
        </header>

        {children}
      </div>
    </main>
  )
}

export function HermesStatusPill({
  tone = 'neutral',
  children,
}: {
  tone?: 'success' | 'warning' | 'danger' | 'neutral'
  children: ReactNode
}) {
  const classes = {
    success: 'border-primary/40 bg-primary/15 text-primary',
    warning: 'border-yellow-500/40 bg-yellow-500/15 text-yellow-600',
    danger: 'border-destructive/40 bg-destructive/15 text-destructive',
    neutral: 'border-border bg-secondary text-muted-foreground',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${classes[tone]}`}>
      {children}
    </span>
  )
}

export function HermesInfoCard({
  title,
  meta,
  children,
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {meta}
      </div>
      {children}
    </section>
  )
}

export function HermesFileBlock({
  title,
  path,
  content,
  exists,
  lines,
  emptyLabel = '文件缺失',
}: {
  title: string
  path: string
  content: string | null
  exists: boolean
  lines?: number
  emptyLabel?: string
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <HermesStatusPill tone={exists ? 'success' : 'danger'}>
            {exists ? `${lines || 0} 行` : emptyLabel}
          </HermesStatusPill>
        </div>
        <span className="break-all text-xs text-muted-foreground">{path}</span>
      </div>
      <div className="p-5">
        {content ? (
          <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground/90">
            {content}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        )}
      </div>
    </section>
  )
}
