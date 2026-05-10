'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

type JsonObject = Record<string, unknown>
type SkillAction = 'check' | 'approve' | 'reject'

interface HermesStatus {
  summary?: string
  harnessRoot?: string
  scriptPath?: string
  scriptExists?: boolean
}

interface HermesRunResult {
  success?: boolean
  command?: string
  stdout?: string
  stderr?: string
  data?: unknown
}

interface SkillRow {
  id: string
  name: string
  version: string
  source: string
  status: 'approved' | 'pending' | 'rejected'
  reason: string
}

const ENDPOINT = '/api/harness/hermes/skill-curator'
const DEFAULT_TENANT = 'tenant-test-001'

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function shortPath(value: string | undefined): string {
  if (!value) return 'not configured'
  return value.replace(/^\/Users\/clare\//, '~/')
}

function statusDotClass(status: 'ready' | 'pending' | 'danger') {
  if (status === 'ready') return 'bg-green-500'
  if (status === 'pending') return 'bg-yellow-500'
  return 'bg-red-500'
}

function skillStatus(value: unknown): SkillRow['status'] {
  if (value === 'approved' || value === 'pending' || value === 'rejected') return value
  return 'pending'
}

function parseSkillList(value: unknown, fallbackStatus: SkillRow['status']): SkillRow[] {
  if (!Array.isArray(value)) return []

  return value.slice(0, 20).map((item, index) => {
    const row = asObject(item)
    return {
      id: asString(row.id || row.slug, `skill-${index + 1}`),
      name: asString(row.name || row.title, `Skill ${index + 1}`),
      version: asString(row.version, 'v0.1.0'),
      source: asString(row.source || row.path, 'tenant skills'),
      status: skillStatus(row.status || fallbackStatus),
      reason: asString(row.reason || row.description, 'No review note returned'),
    }
  })
}

function defaultApprovedSkills(): SkillRow[] {
  return [
    { id: 'profile-setup', name: 'Profile Setup', version: 'v1.0.0', source: 'Hermes core', status: 'approved', reason: 'Required to generate profile vars and SOUL.md' },
    { id: 'boundary-watchdog', name: 'Boundary Watchdog', version: 'v1.0.0', source: 'Hermes core', status: 'approved', reason: 'Required for hard-control evidence' },
    { id: 'output-checker', name: 'Output Checker', version: 'v1.0.0', source: 'Hermes core', status: 'approved', reason: 'Required before customer UAT' },
  ]
}

function defaultPendingSkills(): SkillRow[] {
  return [
    { id: 'customer-research', name: 'Customer Research', version: 'v0.2.0', source: 'tenant proposal', status: 'pending', reason: 'Needs Clare approval before runtime exposure' },
    { id: 'channel-operator', name: 'Channel Operator', version: 'v0.1.0', source: 'tenant proposal', status: 'pending', reason: 'Needs channel permission review' },
  ]
}

function actionLabel(action: SkillAction) {
  if (action === 'approve') return 'Approve'
  if (action === 'reject') return 'Reject'
  return 'Check'
}

export function HermesSkillCuratorPanel() {
  const { activeTenant } = useMissionControl()
  const tenantSlug = activeTenant?.slug || DEFAULT_TENANT
  const defaultSkillsDir = `phase0/tenants/${tenantSlug}/skills`
  const defaultConfigPath = `phase0/tenants/${tenantSlug}/approved-skills.json`
  const defaultBackupDir = `phase0/tenants/${tenantSlug}/skills-backup`

  const [skillsDir, setSkillsDir] = useState(defaultSkillsDir)
  const [configPath, setConfigPath] = useState(defaultConfigPath)
  const [backupDir, setBackupDir] = useState(defaultBackupDir)
  const [selectedSkillId, setSelectedSkillId] = useState('customer-research')
  const [reviewNote, setReviewNote] = useState('')
  const [status, setStatus] = useState<HermesStatus | null>(null)
  const [result, setResult] = useState<HermesRunResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningAction, setRunningAction] = useState<SkillAction | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setSkillsDir(defaultSkillsDir)
    setConfigPath(defaultConfigPath)
    setBackupDir(defaultBackupDir)
  }, [defaultBackupDir, defaultConfigPath, defaultSkillsDir])

  const resultData = useMemo(() => asObject(result?.data), [result?.data])
  const approvedSkills = useMemo(() => {
    const parsed = parseSkillList(resultData.approved || resultData.approvedSkills || resultData.skills, 'approved')
      .filter(skill => skill.status === 'approved')
    return parsed.length ? parsed : defaultApprovedSkills()
  }, [resultData])
  const pendingSkills = useMemo(() => {
    const parsed = parseSkillList(resultData.pending || resultData.pendingSkills || resultData.candidates, 'pending')
      .filter(skill => skill.status === 'pending')
    return parsed.length ? parsed : defaultPendingSkills()
  }, [resultData])
  const rejectedSkills = useMemo(() => {
    return parseSkillList(resultData.rejected || resultData.rejectedSkills, 'rejected')
      .filter(skill => skill.status === 'rejected')
  }, [resultData])
  const selectedSkill = useMemo(() => {
    return pendingSkills.find(skill => skill.id === selectedSkillId) || pendingSkills[0] || null
  }, [pendingSkills, selectedSkillId])
  const healthState = useMemo(() => {
    if (runningAction) return 'pending'
    if (error) return 'danger'
    if (status?.scriptExists && result?.success !== false) return 'ready'
    return 'pending'
  }, [error, result?.success, runningAction, status?.scriptExists])

  useEffect(() => {
    if (selectedSkill && !pendingSkills.some(skill => skill.id === selectedSkillId)) {
      setSelectedSkillId(selectedSkill.id)
    }
  }, [pendingSkills, selectedSkill, selectedSkillId])

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
      if (!response.ok) throw new Error(body?.error || 'Failed to load Hermes skill curator status')
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

  async function runSkillAction(action: SkillAction, skillId = selectedSkill?.id || selectedSkillId) {
    setRunningAction(action)
    setError('')
    setResult(null)

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          skillId,
          reviewNote,
          skillsDir,
          configPath,
          backupDir,
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
              <span className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">H-03</span>
              <h1 className="text-2xl font-semibold text-foreground">Hermes Skill Curator</h1>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Approved Skills, Pending Skills, version inventory, and approval controls for tenant {tenantSlug}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading}>Refresh</Button>
            <Button size="sm" onClick={() => runSkillAction('check')} disabled={Boolean(runningAction)}>
              {runningAction === 'check' ? 'Running' : 'Check'}
            </Button>
            <Button variant="success" size="sm" onClick={() => runSkillAction('approve')} disabled={Boolean(runningAction) || !selectedSkill}>
              {runningAction === 'approve' ? 'Running' : 'Approve'}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => runSkillAction('reject')} disabled={Boolean(runningAction) || !selectedSkill}>
              {runningAction === 'reject' ? 'Running' : 'Reject'}
            </Button>
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status?.scriptExists ? 'ready' : 'danger')}`} />
            <h2 className="text-lg font-semibold">Script</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{status?.scriptExists ? 'Ready' : 'Missing'}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(healthState)}`} />
            <h2 className="text-lg font-semibold">审批</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{pendingSkills.length} pending</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Approved</h2>
          <p className="mt-2 text-sm text-muted-foreground">{approvedSkills.length} skills</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Rejected</h2>
          <p className="mt-2 text-sm text-muted-foreground">{rejectedSkills.length} skills</p>
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
                <span className="text-xs font-medium text-muted-foreground">Skills dir</span>
                <input className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" value={skillsDir} onChange={event => setSkillsDir(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Approved config</span>
                <input className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" value={configPath} onChange={event => setConfigPath(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Backup dir</span>
                <input className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" value={backupDir} onChange={event => setBackupDir(event.target.value)} />
              </label>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold">Review Queue</h2>
            <div className="mt-4 space-y-2">
              {pendingSkills.map(skill => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => setSelectedSkillId(skill.id)}
                  className={`w-full rounded-md border p-3 text-left transition ${
                    selectedSkill?.id === skill.id ? 'border-primary/60 bg-primary/10' : 'border-border bg-background hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{skill.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{skill.reason}</div>
                    </div>
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                  </div>
                </button>
              ))}
            </div>
            <label className="mt-4 grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Review note</span>
              <textarea className="min-h-[84px] rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50" value={reviewNote} onChange={event => setReviewNote(event.target.value)} placeholder="审批理由 / reject reason" />
            </label>
          </div>

          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold">Runtime</h2>
            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              <div className="truncate font-mono">Script: {shortPath(status?.scriptPath)}</div>
              <div className="truncate font-mono">Harness: {shortPath(status?.harnessRoot)}</div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold">Approved Skills</h2>
              <div className="mt-4 overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-background text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Skill</th>
                      <th className="px-3 py-2 font-medium">Version</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {approvedSkills.map(skill => (
                      <tr key={skill.id}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-green-500" />
                            <span className="font-medium text-foreground">{skill.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{skill.version}</td>
                        <td className="px-3 py-2 text-muted-foreground">{skill.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold">Pending Skills</h2>
              <div className="mt-4 space-y-2">
                {pendingSkills.map(skill => (
                  <div key={skill.id} className="rounded-md border border-border bg-background p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">{skill.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{skill.version} / {skill.source}</div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="success" size="xs" onClick={() => runSkillAction('approve', skill.id)} disabled={Boolean(runningAction)}>Approve</Button>
                        <Button variant="destructive" size="xs" onClick={() => runSkillAction('reject', skill.id)} disabled={Boolean(runningAction)}>Reject</Button>
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{skill.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold">版本信息</h2>
              <div className="mt-4 space-y-3">
                {[...approvedSkills, ...pendingSkills].slice(0, 8).map(skill => (
                  <div key={`${skill.id}-${skill.status}`} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{skill.id}</div>
                      <div className="text-xs text-muted-foreground">{skill.status}</div>
                    </div>
                    <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">{skill.version}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold">Execution Payload</h2>
              <pre className="mt-4 max-h-[420px] overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
                {formatJson(result || status || { loading })}
              </pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
