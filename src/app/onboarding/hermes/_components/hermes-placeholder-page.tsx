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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Hermes Build</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </header>

        <section className="rounded-lg border border-dashed border-muted-foreground/30 bg-card/60 p-8 text-center text-sm text-muted-foreground">
          {pending}
        </section>
      </div>
    </main>
  )
}
