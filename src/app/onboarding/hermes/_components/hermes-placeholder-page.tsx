import Link from 'next/link'

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
