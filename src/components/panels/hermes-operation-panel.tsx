'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

interface FieldOption {
  label: string
  value: string
}

interface FieldConfig {
  name: string
  label: string
  placeholder?: string
  type?: 'text' | 'number' | 'textarea' | 'select'
  options?: FieldOption[]
}

interface ActionConfig {
  id: string
  label: string
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'success'
  body: Record<string, string | number | boolean>
}

interface HermesOperationPanelProps {
  stage: string
  title: string
  endpoint: string
  defaultValues: Record<string, string>
  fields: FieldConfig[]
  actions: ActionConfig[]
}

interface StatusPayload {
  summary?: string
  harnessRoot?: string
  scriptPath?: string
  scriptExists?: boolean
  actions?: string[]
  guardianScripts?: Array<{ script: string; path: string; exists: boolean }>
}

function formatJson(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function shortPath(value: string | undefined): string {
  if (!value) return 'not configured'
  return value.replace(/^\/Users\/clare\//, '~/')
}

export function HermesOperationPanel({
  stage,
  title,
  endpoint,
  defaultValues,
  fields,
  actions,
}: HermesOperationPanelProps) {
  const [values, setValues] = useState<Record<string, string>>(defaultValues)
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>(null)

  const statusTone = useMemo(() => {
    if (!status) return 'border-border bg-secondary text-muted-foreground'
    return status.scriptExists
      ? 'border-green-500/30 bg-green-500/10 text-green-300'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  }, [status])

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(endpoint, { cache: 'no-store' })
      if (response.status === 401) {
        window.location.assign('/login')
        return
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'Failed to load Hermes status')
      setStatus(body)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    loadStatus().catch(() => {})
  }, [loadStatus])

  const updateValue = (name: string, value: string) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  const runAction = async (action: ActionConfig) => {
    setRunningAction(action.id)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, ...action.body }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || `${action.label} failed`)
      setResult(body)
      await loadStatus()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setRunningAction(null)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <header className="flex flex-col gap-3 rounded-lg border border-border bg-card/70 p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
              {stage}
            </span>
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{status?.summary || endpoint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded border px-2 py-1 text-xs ${statusTone}`}>
            {loading ? 'checking' : status?.scriptExists ? 'script ready' : 'script missing'}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={loadStatus} disabled={loading}>
            Refresh
          </Button>
        </div>
      </header>

      {status?.guardianScripts ? (
        <section className="rounded-lg border border-border bg-card/60 p-4">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {status.guardianScripts.map(script => (
              <div key={script.script} className="rounded border border-border bg-background/60 p-3">
                <div className="text-sm font-medium text-foreground">{script.script}</div>
                <div className={script.exists ? 'text-xs text-green-300' : 'text-xs text-amber-300'}>
                  {script.exists ? 'ready' : 'missing'}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="space-y-4 rounded-lg border border-border bg-card/60 p-4">
          <div className="grid gap-3">
            {fields.map(field => (
              <label key={field.name} className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase text-muted-foreground">{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea
                    className="min-h-[88px] rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                    value={values[field.name] || ''}
                    placeholder={field.placeholder}
                    onChange={event => updateValue(field.name, event.target.value)}
                  />
                ) : field.type === 'select' ? (
                  <select
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                    value={values[field.name] || ''}
                    onChange={event => updateValue(field.name, event.target.value)}
                  >
                    {(field.options || []).map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={values[field.name] || ''}
                    placeholder={field.placeholder}
                    onChange={event => updateValue(field.name, event.target.value)}
                  />
                )}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {actions.map(action => (
              <Button
                key={action.id}
                type="button"
                variant={action.variant || 'default'}
                size="sm"
                disabled={Boolean(runningAction)}
                onClick={() => runAction(action)}
              >
                {runningAction === action.id ? 'Running' : action.label}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-card/60 p-4">
          <div className="grid gap-2 text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Endpoint</span>
              <div className="font-mono">{endpoint}</div>
            </div>
            <div>
              <span className="font-medium text-foreground">Harness root</span>
              <div className="font-mono">{shortPath(status?.harnessRoot)}</div>
            </div>
            <div>
              <span className="font-medium text-foreground">Script</span>
              <div className="break-all font-mono">{shortPath(status?.scriptPath)}</div>
            </div>
          </div>

          {error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <pre className="min-h-[280px] overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-foreground">
            {result ? formatJson(result) : formatJson(status || { status: loading ? 'loading' : 'idle' })}
          </pre>
        </section>
      </div>
    </div>
  )
}
