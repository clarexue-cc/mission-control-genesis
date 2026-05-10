'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

type JsonObject = Record<string, unknown>
type RunAction = 'check' | 'dry-run' | 'run'

interface HermesStatus {
  summary?: string
  harnessRoot?: string
  scriptPath?: string
  scriptExists?: boolean
  actions?: string[]
}

interface HermesRunResult {
  success?: boolean
  command?: string
  stdout?: string
  stderr?: string
  data?: unknown
}

interface SkillPreview {
  id: string
  name: string
  status: 'ready' | 'pending' | 'missing'
  reason: string
}

const ENDPOINT = '/api/harness/hermes/profile-setup'
const DEFAULT_TENANT = 'tenant-test-001'

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function shortPath(value: string | undefined): string {
  if (!value) return 'not configured'
  return value.replace(/^\/Users\/clare\//, '~/')
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function findText(data: JsonObject, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return fallback
}

function findSkills(data: JsonObject): SkillPreview[] {
  const raw = data.skills || data.skill_candidates || data.approvedSkills
  if (!Array.isArray(raw)) return []

  return raw.slice(0, 8).map((item, index) => {
    const row = asObject(item)
    return {
      id: asString(row.id, `skill-${index + 1}`),
      name: asString(row.name || row.title, `Skill ${index + 1}`),
      status: row.status === 'missing' ? 'missing' : row.status === 'pending' ? 'pending' : 'ready',
      reason: asString(row.reason || row.description, 'Generated from intake profile'),
    }
  })
}

function statusDotClass(status: 'ready' | 'pending' | 'missing') {
  if (status === 'ready') return 'bg-green-500'
  if (status === 'pending') return 'bg-yellow-500'
  return 'bg-red-500'
}

function actionLabel(action: RunAction) {
  if (action === 'check') return 'Check'
  if (action === 'dry-run') return 'Dry Run'
  return 'Run'
}

export function HermesProfileSetupPanel() {
  const { activeTenant } = useMissionControl()
  const tenantSlug = activeTenant?.slug || DEFAULT_TENANT
  const defaultIntakePath = `phase0/tenants/${tenantSlug}/intake/client-intake-filled.md`
  const defaultOutputPath = `phase0/tenants/${tenantSlug}`

  const [intakePath, setIntakePath] = useState(defaultIntakePath)
  const [outputPath, setOutputPath] = useState(defaultOutputPath)
  const [status, setStatus] = useState<HermesStatus | null>(null)
  const [result, setResult] = useState<HermesRunResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningAction, setRunningAction] = useState<RunAction | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setIntakePath(defaultIntakePath)
    setOutputPath(defaultOutputPath)
  }, [defaultIntakePath, defaultOutputPath])

  const resultData = useMemo(() => asObject(result?.data), [result?.data])
  const intakePreview = useMemo(() => findText(resultData, [
    'intakePreview',
    'intake_preview',
    'intake',
    'profileInput',
  ], [
    '# Intake preview',
    `Tenant: ${tenantSlug}`,
    `Source: ${intakePath}`,
    '',
    'Run Check or Dry Run to load the customer intake summary.',
  ].join('\n')), [intakePath, resultData, tenantSlug])
  const soulPreview = useMemo(() => findText(resultData, [
    'soulPreview',
    'soul_preview',
    'soul',
    'SOUL.md',
  ], [
    '# SOUL.md preview',
    'Hermes will render identity, tone, boundaries, and operating rules here.',
    '',
    'No generated SOUL.md payload has been returned yet.',
  ].join('\n')), [resultData])
  const skills = useMemo(() => {
    const parsed = findSkills(resultData)
    if (parsed.length) return parsed
    return [
      { id: 'customer-profile', name: 'Customer Profile Builder', status: 'pending' as const, reason: 'Maps intake facts into profile vars' },
      { id: 'soul-renderer', name: 'SOUL Renderer', status: 'pending' as const, reason: 'Produces tenant identity draft' },
      { id: 'skill-seed', name: 'Skill Seed List', status: 'pending' as const, reason: 'Suggests initial Hermes skill set' },
    ]
  }, [resultData])

  const executionState = useMemo(() => {
    if (runningAction) return 'running'
    if (error) return 'failed'
    if (result?.success) return 'ready'
    if (status?.scriptExists) return 'pending'
    return 'missing'
  }, [error, result?.success, runningAction, status?.scriptExists])

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(ENDPOINT, { cache: 'no-store' })
      if (response.status === 401) {
        window.location.assign('/login')
        return
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'Failed to load Hermes profile status')
      setStatus(body)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus().catch(() => {})
  }, [loadStatus])

  async function runProfileAction(action: RunAction) {
    setRunningAction(action)
    setError('')
    setResult(null)

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          intakePath,
          outputPath,
          dryRun: action !== 'run',
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || `${actionLabel(action)} failed`)
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
      <header className="rounded-lg border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">H-01</span>
              <h1 className="text-2xl font-semibold text-foreground">Hermes Profile Setup</h1>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Intake to profile vars to SOUL.md to skills seed. Tenant: {tenantSlug}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading}>Refresh</Button>
            {(['check', 'dry-run', 'run'] as RunAction[]).map(action => (
              <Button
                key={action}
                variant={action === 'run' ? 'success' : action === 'dry-run' ? 'secondary' : 'default'}
                size="sm"
                disabled={Boolean(runningAction)}
                onClick={() => runProfileAction(action)}
              >
                {runningAction === action ? 'Running' : actionLabel(action)}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status?.scriptExists ? 'ready' : 'missing')}`} />
            <h2 className="text-lg font-semibold">Script</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{status?.scriptExists ? 'Ready' : 'Missing'}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(executionState === 'ready' ? 'ready' : executionState === 'failed' ? 'missing' : 'pending')}`} />
            <h2 className="text-lg font-semibold">执行状态</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{runningAction ? `${actionLabel(runningAction)} running` : executionState}</p>
        </div>
        <div className="rounded-lg border bg-card p-6 md:col-span-2">
          <h2 className="text-lg font-semibold">Paths</h2>
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
            <span className="truncate font-mono">Intake: {intakePath}</span>
            <span className="truncate font-mono">Output: {outputPath}</span>
            <span className="truncate font-mono">Script: {shortPath(status?.scriptPath)}</span>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold">Configuration</h2>
            <div className="mt-4 space-y-3">
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Intake path</span>
                <input className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" value={intakePath} onChange={event => setIntakePath(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Output path</span>
                <input className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" value={outputPath} onChange={event => setOutputPath(event.target.value)} />
              </label>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold">Skills</h2>
            <div className="mt-4 space-y-2">
              {skills.map(skill => (
                <div key={skill.id} className="rounded-md border border-border bg-background p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{skill.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{skill.reason}</div>
                    </div>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(skill.status)}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold">Intake File Preview</h2>
            <pre className="mt-4 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
              {intakePreview}
            </pre>
          </div>

          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold">Generated SOUL.md Preview</h2>
            <pre className="mt-4 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
              {soulPreview}
            </pre>
          </div>

          <div className="rounded-lg border bg-card p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold">Execution Payload</h2>
            <pre className="mt-4 max-h-[300px] overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
              {formatJson(result || status || { loading })}
            </pre>
          </div>
        </div>
      </section>
    </div>
  )
}
