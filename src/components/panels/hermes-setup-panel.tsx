'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'

type SetupStep = {
  id: 'config-yaml' | 'soul-md' | 'agents-md' | 'cron-jobs' | 'cron-allowlist'
  label: string
  status: 'ready' | 'warning' | 'missing'
  detail: string
}

type HermesSetupState = {
  daemon_running: boolean
  pid: number | null
  setup: {
    ready: boolean
    status: 'ready' | 'needs-attention' | 'blocked'
    ready_steps: number
    warning_steps: number
    blocking_steps: number
    total_steps: number
    steps: SetupStep[]
  }
  config: {
    config_path: string
    config_exists: boolean
    soul_path: string
    soul_exists: boolean
    agents_path: string
    agents_exists: boolean
    cron_jobs_path: string
    cron_jobs_exists: boolean
    cron_allowlist_path: string
    cron_allowlist_exists: boolean
    provider: string | null
    model: string | null
  }
  allowlist: {
    path: string
    exists: boolean
    job_ids: string[]
  }
  inspection: {
    last_run_at: string | null
  }
  cron: {
    total_jobs: number
    enabled_jobs: number
    openclaw_monitoring: boolean
    heartbeat_monitoring: boolean
    evidence: string
    last_run_at: string | null
    jobs: HermesCronJob[]
  }
  targets: Array<{ stale: boolean }>
}

type HermesCronJob = {
  id: string
  name: string
  schedule: string
  enabled: boolean
  prompt: string
  lastRunAt: string | null
  runCount: number
}

type CronDraft = {
  id: string
  name: string
  schedule: string
  prompt: string
  enabled: boolean
}

const panelClassName = 'rounded-lg border border-border bg-card/70'
const inputClassName = 'w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50'
const textareaClassName = `${inputClassName} min-h-24 resize-none font-mono text-xs leading-relaxed`
const DEFAULT_MONITOR_ID = 'mission-control-openclaw-heartbeat'
const DEFAULT_MONITOR_PROMPT = [
  'Check OpenClaw Agent-* working-context heartbeat freshness for Mission Control.',
  'Inspect Agent-* directories, report stale or missing working-context.md files, and keep output concise.',
  'Write evidence only through Agent-Shared/hermes-log.md and Agent-Shared/hermes-alerts.jsonl.',
  'Do not modify tenant business vault files.',
].join(' ')

function statusClassName(status: HermesSetupState['setup']['status'] | SetupStep['status']) {
  if (status === 'ready') return 'bg-green-500/15 text-green-300 border-green-500/25'
  if (status === 'needs-attention' || status === 'warning') return 'bg-amber-500/15 text-amber-300 border-amber-500/25'
  return 'bg-red-500/15 text-red-300 border-red-500/25'
}

function statusLabel(status: HermesSetupState['setup']['status']) {
  if (status === 'ready') return 'ready'
  if (status === 'needs-attention') return 'needs attention'
  return 'blocked'
}

function formatDate(value: string | null) {
  if (!value) return 'never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function HermesSetupPanel() {
  const [state, setState] = useState<HermesSetupState | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [defaultSchedule, setDefaultSchedule] = useState('*/30 * * * *')
  const [defaultPrompt, setDefaultPrompt] = useState(DEFAULT_MONITOR_PROMPT)
  const [defaultEnabled, setDefaultEnabled] = useState(true)
  const [draft, setDraft] = useState<CronDraft>({
    id: '',
    name: '',
    schedule: '0 * * * *',
    prompt: '',
    enabled: true,
  })
  const [editingJobId, setEditingJobId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<CronDraft | null>(null)

  const hasCronMonitoring = Boolean(state?.cron.openclaw_monitoring && state.cron.heartbeat_monitoring)
  const staleTargets = useMemo(() => state?.targets.filter(target => target.stale).length || 0, [state])
  const defaultJob = useMemo(
    () => state?.cron.jobs.find(job => job.id === DEFAULT_MONITOR_ID) || null,
    [state],
  )

  const loadState = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/harness/hermes', { cache: 'no-store' })
      const body = await response.json() as HermesSetupState & { error?: string }
      if (!response.ok) throw new Error(body.error || 'Failed to load Hermes setup')
      setState(body)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadState().catch(() => {})
  }, [loadState])

  useEffect(() => {
    if (!defaultJob) return
    setDefaultSchedule(defaultJob.schedule || '*/30 * * * *')
    setDefaultPrompt(defaultJob.prompt || DEFAULT_MONITOR_PROMPT)
    setDefaultEnabled(defaultJob.enabled)
  }, [defaultJob])

  async function runAction(nextAction: 'register-cron' | 'save-cron-job' | 'toggle-cron-job' | 'remove-cron-job' | 'sync-allowlist' | 'start' | 'check', payload: Record<string, unknown> = {}) {
    setAction(nextAction)
    setError(null)
    try {
      const response = await fetch('/api/harness/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: nextAction, ...payload }),
      })
      const body = await response.json() as { state?: HermesSetupState; error?: string }
      if (!response.ok) throw new Error(body.error || `Hermes ${nextAction} failed`)
      if (body.state) setState(body.state)
      await loadState()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    } finally {
      setAction(null)
    }
  }

  async function saveDefaultMonitor() {
    await runAction('register-cron', {
      schedule: defaultSchedule,
      prompt: defaultPrompt,
      enabled: defaultEnabled,
    })
  }

  async function saveDraft() {
    await runAction('save-cron-job', draft)
    setDraft({ id: '', name: '', schedule: '0 * * * *', prompt: '', enabled: true })
  }

  async function saveEditDraft() {
    if (!editDraft) return
    await runAction('save-cron-job', editDraft)
    setEditingJobId(null)
    setEditDraft(null)
  }

  function startEditing(job: HermesCronJob) {
    setEditingJobId(job.id)
    setEditDraft({
      id: job.id,
      name: job.name || job.id,
      schedule: job.schedule,
      prompt: job.prompt,
      enabled: job.enabled,
    })
  }

  const isBusy = Boolean(action)

  if (loading) return <Loader variant="panel" label="Loading Hermes setup" />

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <section className={`${panelClassName} flex flex-col gap-4 p-5 xl:flex-row xl:items-start xl:justify-between`}>
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Hermes Setup</p>
          <h1 className="text-2xl font-semibold text-foreground">Hermes Setup</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Configure Hermes monitoring prerequisites before P11 evidence review.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={saveDefaultMonitor} disabled={isBusy}>
            {action === 'register-cron' ? 'Saving...' : 'Save Default Monitor'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => runAction('sync-allowlist')} disabled={isBusy}>
            {action === 'sync-allowlist' ? 'Syncing...' : 'Sync Allowlist'}
          </Button>
          <Button size="sm" onClick={() => runAction('start')} disabled={isBusy || state?.daemon_running}>
            {action === 'start' ? 'Starting...' : 'Start Guard'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => runAction('check')} disabled={isBusy}>
            {action === 'check' ? 'Checking...' : 'Force Check'}
          </Button>
          <Button variant="ghost" size="sm" onClick={loadState} disabled={isBusy}>
            Refresh
          </Button>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <section className={`${panelClassName} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Setup Readiness</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              config.yaml, SOUL.md, AGENTS.md, cron jobs, and cron allowlist.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {state?.setup.ready_steps || 0}/{state?.setup.total_steps || 0} ready
            </span>
            <span className={`rounded border px-2 py-1 text-xs ${statusClassName(state?.setup.status || 'blocked')}`}>
              {statusLabel(state?.setup.status || 'blocked')}
            </span>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          {(state?.setup.steps || []).map(step => (
            <div key={step.id} className={`rounded border p-3 ${statusClassName(step.status)}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{step.label}</p>
                <span className="shrink-0 rounded bg-background/40 px-2 py-0.5 text-xs">{step.status}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground" title={step.detail}>{step.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className={`${panelClassName} p-4`}>
          <p className="text-xs text-muted-foreground">Core config</p>
          <p className={`mt-2 text-xl font-semibold ${state?.config.config_exists ? 'text-green-300' : 'text-red-300'}`}>
            {state?.config.config_exists ? 'loaded' : 'missing'}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{state?.config.config_path}</p>
        </section>
        <section className={`${panelClassName} p-4`}>
          <p className="text-xs text-muted-foreground">Cron evidence</p>
          <p className={`mt-2 text-xl font-semibold ${hasCronMonitoring ? 'text-green-300' : 'text-red-300'}`}>
            {hasCronMonitoring ? 'registered' : 'missing'}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{state?.cron.evidence}</p>
        </section>
        <section className={`${panelClassName} p-4`}>
          <p className="text-xs text-muted-foreground">Cron allowlist</p>
          <p className={`mt-2 text-xl font-semibold ${state?.allowlist.exists ? 'text-green-300' : 'text-red-300'}`}>
            {state?.allowlist.exists ? 'found' : 'missing'}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{state?.allowlist.job_ids.length || 0} authorized jobs</p>
        </section>
        <section className={`${panelClassName} p-4`}>
          <p className="text-xs text-muted-foreground">Guard daemon</p>
          <p className={`mt-2 text-xl font-semibold ${state?.daemon_running ? 'text-green-300' : 'text-amber-300'}`}>
            {state?.daemon_running ? 'running' : 'stopped'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">pid {state?.pid || 'none'} · last {formatDate(state?.inspection.last_run_at || null)}</p>
        </section>
        <section className={`${panelClassName} p-4`}>
          <p className="text-xs text-muted-foreground">Heartbeat alerts</p>
          <p className={`mt-2 text-xl font-semibold ${staleTargets ? 'text-amber-300' : 'text-green-300'}`}>{staleTargets}</p>
          <p className="mt-1 text-xs text-muted-foreground">stale or missing targets</p>
        </section>
      </div>

      <section className={`${panelClassName} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Default OpenClaw Monitor</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {defaultJob ? `registered as ${defaultJob.id}` : 'not registered'}
            </p>
          </div>
          <label className="flex items-center gap-2 rounded border border-border/70 px-3 py-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={defaultEnabled}
              onChange={(event) => setDefaultEnabled(event.target.checked)}
              className="h-4 w-4"
            />
            enabled
          </label>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr_auto]">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Schedule</span>
            <input
              value={defaultSchedule}
              onChange={(event) => setDefaultSchedule(event.target.value)}
              className={inputClassName}
              placeholder="*/30 * * * *"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Prompt</span>
            <textarea
              value={defaultPrompt}
              onChange={(event) => setDefaultPrompt(event.target.value)}
              className={textareaClassName}
            />
          </label>
          <div className="flex items-end">
            <Button size="sm" onClick={saveDefaultMonitor} disabled={isBusy}>
              {action === 'register-cron' ? 'Saving...' : defaultJob ? 'Update' : 'Register'}
            </Button>
          </div>
        </div>
      </section>

      <section className={`${panelClassName} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Hermes Cron Jobs</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {state?.cron.enabled_jobs || 0}/{state?.cron.total_jobs || 0} enabled
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {(state?.cron.jobs || []).length === 0 ? (
            <div className="rounded border border-border/60 px-3 py-4 text-sm text-muted-foreground">No Hermes cron jobs configured.</div>
          ) : (
            state?.cron.jobs.map(job => {
              const editing = editingJobId === job.id && editDraft
              return (
                <div key={job.id} className="rounded border border-border/60 p-3">
                  {editing ? (
                    <div className="grid gap-3 lg:grid-cols-[180px_180px_1fr_auto]">
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">ID</span>
                        <input
                          value={editDraft.id}
                          onChange={(event) => setEditDraft({ ...editDraft, id: event.target.value })}
                          className={inputClassName}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Schedule</span>
                        <input
                          value={editDraft.schedule}
                          onChange={(event) => setEditDraft({ ...editDraft, schedule: event.target.value })}
                          className={inputClassName}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Prompt</span>
                        <textarea
                          value={editDraft.prompt}
                          onChange={(event) => setEditDraft({ ...editDraft, prompt: event.target.value })}
                          className={textareaClassName}
                        />
                      </label>
                      <div className="flex flex-col justify-end gap-2">
                        <label className="flex items-center gap-2 rounded border border-border/70 px-3 py-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={editDraft.enabled}
                            onChange={(event) => setEditDraft({ ...editDraft, enabled: event.target.checked })}
                            className="h-4 w-4"
                          />
                          enabled
                        </label>
                        <Button size="sm" onClick={saveEditDraft} disabled={isBusy}>Save</Button>
                        <Button variant="ghost" size="sm" onClick={() => { setEditingJobId(null); setEditDraft(null) }} disabled={isBusy}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground">{job.name || job.id}</h3>
                          <span className={`rounded px-2 py-0.5 text-xs ${job.enabled ? 'bg-green-500/15 text-green-300' : 'bg-muted text-muted-foreground'}`}>
                            {job.enabled ? 'enabled' : 'disabled'}
                          </span>
                          <span className="rounded border border-border/60 px-2 py-0.5 font-mono text-xs text-muted-foreground">{job.schedule}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{job.id}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground" title={job.prompt}>{job.prompt || '-'}</p>
                        <p className="text-xs text-muted-foreground">runs {job.runCount} · last {job.lastRunAt || 'never'}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => runAction('toggle-cron-job', { id: job.id, enabled: !job.enabled })}
                          disabled={isBusy}
                        >
                          {job.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => startEditing(job)} disabled={isBusy}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => runAction('remove-cron-job', { id: job.id })}
                          disabled={isBusy}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </section>

      <section className={`${panelClassName} p-4`}>
        <h2 className="text-sm font-semibold text-foreground">Add Hermes Cron Job</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-[180px_200px_1fr_auto]">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">ID</span>
            <input
              value={draft.id}
              onChange={(event) => setDraft({ ...draft, id: event.target.value })}
              className={inputClassName}
              placeholder="daily-openclaw-check"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Schedule</span>
            <input
              value={draft.schedule}
              onChange={(event) => setDraft({ ...draft, schedule: event.target.value })}
              className={inputClassName}
              placeholder="0 * * * *"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Prompt</span>
            <textarea
              value={draft.prompt}
              onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
              className={textareaClassName}
              placeholder="Check OpenClaw heartbeat and report evidence."
            />
          </label>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 rounded border border-border/70 px-3 py-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                className="h-4 w-4"
              />
              enabled
            </label>
            <Button size="sm" onClick={saveDraft} disabled={isBusy || !draft.id.trim() || !draft.prompt.trim()}>
              Add Job
            </Button>
          </div>
        </div>
      </section>

      <section className={`${panelClassName} p-4`}>
        <h2 className="text-sm font-semibold text-foreground">Hermes Files</h2>
        <div className="mt-4 grid gap-2 text-xs md:grid-cols-2">
          {[
            ['config.yaml', state?.config.config_path, state?.config.config_exists],
            ['SOUL.md', state?.config.soul_path, state?.config.soul_exists],
            ['AGENTS.md', state?.config.agents_path, state?.config.agents_exists],
            ['cron/jobs.json', state?.config.cron_jobs_path, state?.config.cron_jobs_exists],
            ['cron/allowlist.yaml', state?.config.cron_allowlist_path, state?.config.cron_allowlist_exists],
          ].map(([label, filePath, exists]) => (
            <div key={String(label)} className="flex min-w-0 items-center justify-between gap-3 rounded border border-border/60 px-3 py-2">
              <div className="min-w-0">
                <div className="font-medium text-foreground">{label}</div>
                <div className="truncate text-muted-foreground" title={String(filePath || '')}>{filePath || '-'}</div>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 ${exists ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
                {exists ? 'found' : 'missing'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
