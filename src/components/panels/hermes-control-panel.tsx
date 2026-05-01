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
  config: {
    config_path: string
    config_exists: boolean
    soul_path: string
    soul_exists: boolean
    agents_path: string
    agents_exists: boolean
    cron_jobs_path: string
    cron_jobs_exists: boolean
    provider: string | null
    model: string | null
    base_url: string | null
    toolsets: string[]
    max_turns: number | null
    gateway_timeout: number | null
    terminal_backend: string | null
    terminal_cwd: string | null
    browser_private_urls: boolean | null
  }
  cron: {
    total_jobs: number
    enabled_jobs: number
    openclaw_monitoring: boolean
    heartbeat_monitoring: boolean
    last_run_at: string | null
    evidence: string
    jobs: Array<{
      id: string
      schedule: string
      enabled: boolean
      lastRunAt: string | null
      runCount: number
      evidence: string
    }>
  }
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

function ConfigMetric({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded border border-border/70 bg-secondary/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-foreground">{value ?? '-'}</p>
    </div>
  )
}

function ConfigPathRow({ label, path, exists }: { label: string; path: string | undefined; exists: boolean | undefined }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded border border-border/60 px-3 py-2 text-xs">
      <div className="min-w-0">
        <div className="font-medium text-foreground">{label}</div>
        <div className="truncate text-muted-foreground" title={path}>{path || '-'}</div>
      </div>
      <span className={`shrink-0 rounded px-2 py-0.5 ${exists ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
        {exists ? 'found' : 'missing'}
      </span>
    </div>
  )
}

export function HermesControlPanel() {
  const [state, setState] = useState<HermesState | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const staleCount = useMemo(() => state?.targets.filter(target => target.stale).length || 0, [state])
  const hasCronMonitoring = Boolean(state?.cron.openclaw_monitoring && state.cron.heartbeat_monitoring)

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
            Hermes cron evidence, MC guard daemon status, tenant heartbeat freshness, forced inspections, and alert log.
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

      <div className="grid gap-4 lg:grid-cols-6">
        <section className={`${panelClassName} p-4 lg:col-span-2`}>
          <p className="text-xs text-muted-foreground">Hermes cron evidence</p>
          <p className={`mt-2 text-xl font-semibold ${hasCronMonitoring ? 'text-green-300' : 'text-red-300'}`}>
            {hasCronMonitoring ? 'monitoring' : 'not proven'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{state?.cron.evidence || 'No cron evidence loaded'}</p>
        </section>
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
          <p className="text-xs text-muted-foreground">Last cron run</p>
          <p className="mt-2 text-xl font-semibold text-foreground">{formatDate(state?.cron.last_run_at || null)}</p>
          <p className="mt-1 text-xs text-muted-foreground">stale threshold {formatAge(state?.stale_seconds || 0)}</p>
        </section>
      </div>

      {!hasCronMonitoring && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-700 dark:text-amber-100">
          当前没有 Hermes cron 定时任务证据，不能证明 Hermes 正在定时监控 OpenClaw。请先在 Hermes cron 中配置包含 OpenClaw heartbeat / working-context 检查的任务，或启动 MC guard daemon 作为临时巡检。
        </section>
      )}

      <section className={`${panelClassName} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Hermes Config</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Safe summary of config.yaml, SOUL, AGENTS, and Hermes cron job registration.
            </p>
          </div>
          <span className={`rounded px-2 py-1 text-xs ${state?.config.config_exists ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
            {state?.config.config_exists ? 'config loaded' : 'config missing'}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <ConfigMetric label="Provider" value={state?.config.provider} />
          <ConfigMetric label="Model" value={state?.config.model} />
          <ConfigMetric label="Gateway timeout" value={state?.config.gateway_timeout ? `${state.config.gateway_timeout}s` : null} />
          <ConfigMetric label="Toolsets" value={state?.config.toolsets?.join(', ') || null} />
          <ConfigMetric label="Base URL" value={state?.config.base_url} />
          <ConfigMetric label="Terminal backend" value={state?.config.terminal_backend} />
          <ConfigMetric label="Terminal cwd" value={state?.config.terminal_cwd} />
          <ConfigMetric label="Private URLs" value={state?.config.browser_private_urls === null ? null : String(state?.config.browser_private_urls)} />
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <ConfigPathRow label="config.yaml" path={state?.config.config_path} exists={state?.config.config_exists} />
          <ConfigPathRow label="SOUL.md" path={state?.config.soul_path} exists={state?.config.soul_exists} />
          <ConfigPathRow label="AGENTS.md" path={state?.config.agents_path} exists={state?.config.agents_exists} />
          <ConfigPathRow label="Hermes cron jobs" path={state?.config.cron_jobs_path} exists={state?.config.cron_jobs_exists} />
        </div>
      </section>

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
