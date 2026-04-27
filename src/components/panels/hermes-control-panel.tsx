'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'

type HermesTarget = {
  tenant: string
  agent_dir: string
  health: 'fresh' | 'stale' | 'missing'
  context_path: string
  context_exists: boolean
  heartbeat_age_seconds: number | null
  last_heartbeat_at: string | null
  last_check_at: string | null
  last_alert: string | null
  stale: boolean
}

type HermesState = {
  daemon_running: boolean
  pid: number | null
  stale_seconds: number
  vault_root: string
  log_path: string
  log_tail: string
  targets: HermesTarget[]
  scripts: {
    daemon: string
    heartbeat: string
  }
  error?: string
}

const panelClassName = 'rounded-lg border border-border bg-card/70'

function formatAge(seconds: number | null) {
  if (seconds === null) return 'missing'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

function formatDate(value: string | null) {
  if (!value) return 'never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function healthClassName(health: HermesTarget['health']) {
  if (health === 'fresh') return 'bg-green-500/15 text-green-300'
  if (health === 'stale') return 'bg-amber-500/15 text-amber-300'
  return 'bg-red-500/15 text-red-300'
}

export function HermesControlPanel() {
  const [state, setState] = useState<HermesState | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const staleCount = useMemo(() => state?.targets.filter(target => target.stale).length || 0, [state])

  const loadState = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/harness/hermes', { cache: 'no-store' })
      const body = await response.json() as HermesState
      if (!response.ok) throw new Error(body.error || 'Failed to load Hermes state')
      setState(body)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadState().catch(() => {})
    const timer = setInterval(() => loadState().catch(() => {}), 20_000)
    return () => clearInterval(timer)
  }, [loadState])

  async function runAction(nextAction: 'start' | 'stop' | 'check') {
    setAction(nextAction)
    setError(null)
    try {
      const response = await fetch('/api/harness/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: nextAction }),
      })
      const body = await response.json() as { state?: HermesState; error?: string }
      if (!response.ok) throw new Error(body.error || `Hermes ${nextAction} failed`)
      if (body.state) setState(body.state)
      await loadState()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    } finally {
      setAction(null)
    }
  }

  if (loading) {
    return <Loader variant="panel" label="Loading Hermes guard" />
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className={`${panelClassName} flex flex-col gap-4 p-5 xl:flex-row xl:items-start xl:justify-between`}>
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Hermes</p>
          <h1 className="text-2xl font-semibold text-foreground">Hermes Control</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Guard daemon status, tenant heartbeat freshness, forced inspections, and Hermes alert log.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => runAction('start')} disabled={Boolean(action) || state?.daemon_running}>
            {action === 'start' ? 'Starting...' : 'Start'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => runAction('stop')} disabled={Boolean(action) || !state?.daemon_running}>
            {action === 'stop' ? 'Stopping...' : 'Stop'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => runAction('check')} disabled={Boolean(action)}>
            {action === 'check' ? 'Checking...' : 'Force Check'}
          </Button>
          <Button variant="ghost" size="sm" onClick={loadState} disabled={Boolean(action)}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        <section className={`${panelClassName} p-4`}>
          <p className="text-xs text-muted-foreground">Daemon status</p>
          <p className={`mt-2 text-xl font-semibold ${state?.daemon_running ? 'text-green-300' : 'text-red-300'}`}>
            {state?.daemon_running ? 'running' : 'stopped'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">pid {state?.pid || 'none'}</p>
        </section>
        <section className={`${panelClassName} p-4`}>
          <p className="text-xs text-muted-foreground">Targets</p>
          <p className="mt-2 text-xl font-semibold text-foreground">{state?.targets.length || 0}</p>
          <p className="mt-1 text-xs text-muted-foreground">vault agents</p>
        </section>
        <section className={`${panelClassName} p-4`}>
          <p className="text-xs text-muted-foreground">Alerts</p>
          <p className={`mt-2 text-xl font-semibold ${staleCount ? 'text-amber-300' : 'text-green-300'}`}>{staleCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">stale or missing heartbeat</p>
        </section>
        <section className={`${panelClassName} p-4`}>
          <p className="text-xs text-muted-foreground">Stale threshold</p>
          <p className="mt-2 text-xl font-semibold text-foreground">{formatAge(state?.stale_seconds || 0)}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{state?.vault_root}</p>
        </section>
      </div>

      <div className="grid min-h-[48vh] flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className={`${panelClassName} overflow-hidden`}>
          <div className="border-b border-border p-4">
            <h2 className="text-sm font-semibold text-foreground">Guarded Tenants</h2>
            <p className="mt-1 text-xs text-muted-foreground">heartbeat health, last check, last alert, and heartbeat age</p>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-secondary/20 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Health</th>
                  <th className="px-4 py-3">Heartbeat</th>
                  <th className="px-4 py-3">Last check</th>
                  <th className="px-4 py-3">Last alert</th>
                </tr>
              </thead>
              <tbody>
                {(state?.targets || []).map(target => (
                  <tr key={target.agent_dir} className="border-b border-border/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{target.tenant}</div>
                      <div className="text-xs text-muted-foreground">{target.agent_dir}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-1 text-xs ${healthClassName(target.health)}`}>
                        {target.health}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className={target.health === 'fresh' ? 'text-green-300' : target.health === 'stale' ? 'text-amber-300' : 'text-red-300'}>
                        {formatAge(target.heartbeat_age_seconds)}
                      </div>
                      <div className="text-xs text-muted-foreground">{formatDate(target.last_heartbeat_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{target.last_check_at || 'never'}</td>
                    <td className="max-w-[260px] truncate px-4 py-3 text-muted-foreground" title={target.last_alert || ''}>
                      {target.last_alert || 'none'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${panelClassName} flex min-h-0 flex-col overflow-hidden`}>
          <div className="border-b border-border p-4">
            <h2 className="text-sm font-semibold text-foreground">Inspection Log</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">{state?.log_path}</p>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed text-muted-foreground">
            {state?.log_tail || 'No Hermes log entries yet.'}
          </pre>
        </section>
      </div>
    </div>
  )
}
