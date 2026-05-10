'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

type JsonObject = Record<string, unknown>
type BoundaryAction = 'scan' | 'check'

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

interface BoundaryRuleRow {
  id: string
  type: string
  pattern: string
  severity: 'low' | 'medium' | 'high'
  enabled: boolean
}

interface ViolationRow {
  id: string
  session: string
  rule: string
  severity: 'low' | 'medium' | 'high'
  excerpt: string
}

const ENDPOINT = '/api/harness/hermes/boundary'
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

function severity(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'medium'
}

function statusDotClass(status: 'ready' | 'warning' | 'danger') {
  if (status === 'ready') return 'bg-green-500'
  if (status === 'warning') return 'bg-yellow-500'
  return 'bg-red-500'
}

function severityClass(level: 'low' | 'medium' | 'high') {
  if (level === 'high') return 'border-red-500/30 bg-red-500/10 text-red-200'
  if (level === 'medium') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
  return 'border-green-500/30 bg-green-500/10 text-green-200'
}

function parseRules(data: JsonObject): BoundaryRuleRow[] {
  const direct = data.rules || data.boundary_rules || data.forbidden_patterns
  const rows = Array.isArray(direct) ? direct : []
  if (!rows.length) return [
    { id: 'no-secret-leak', type: 'forbidden', pattern: 'api_key|secret|token', severity: 'high', enabled: true },
    { id: 'tenant-scope', type: 'drift', pattern: 'cross-tenant reference', severity: 'high', enabled: true },
    { id: 'identity-drift', type: 'drift', pattern: 'assistant role mismatch', severity: 'medium', enabled: true },
  ]

  return rows.slice(0, 12).map((item, index) => {
    const row = asObject(item)
    return {
      id: asString(row.id || row.name, `rule-${index + 1}`),
      type: asString(row.type || row.kind, 'boundary'),
      pattern: asString(row.pattern || row.match || row.description, 'unconfigured pattern'),
      severity: severity(row.severity),
      enabled: row.enabled !== false,
    }
  })
}

function parseViolations(data: JsonObject): ViolationRow[] {
  const raw = data.violations || data.findings || data.results
  if (!Array.isArray(raw)) return []

  return raw.slice(0, 12).map((item, index) => {
    const row = asObject(item)
    return {
      id: asString(row.id, `violation-${index + 1}`),
      session: asString(row.session || row.file || row.path, `session-${index + 1}`),
      rule: asString(row.rule || row.rule_id || row.name, 'boundary rule'),
      severity: severity(row.severity),
      excerpt: asString(row.excerpt || row.message || row.reason, 'No excerpt returned'),
    }
  })
}

function actionLabel(action: BoundaryAction) {
  return action === 'scan' ? 'Scan' : 'Check'
}

export function HermesBoundaryPanel() {
  const { activeTenant } = useMissionControl()
  const tenantSlug = activeTenant?.slug || DEFAULT_TENANT
  const defaultSessionsDir = `phase0/tenants/${tenantSlug}/sessions`
  const defaultRulesPath = `phase0/tenants/${tenantSlug}/boundary/boundary-rules.json`

  const [sessionsDir, setSessionsDir] = useState(defaultSessionsDir)
  const [rulesPath, setRulesPath] = useState(defaultRulesPath)
  const [driftThreshold, setDriftThreshold] = useState(0.72)
  const [maxViolations, setMaxViolations] = useState(20)
  const [status, setStatus] = useState<HermesStatus | null>(null)
  const [result, setResult] = useState<HermesRunResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningAction, setRunningAction] = useState<BoundaryAction | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setSessionsDir(defaultSessionsDir)
    setRulesPath(defaultRulesPath)
  }, [defaultRulesPath, defaultSessionsDir])

  const resultData = useMemo(() => asObject(result?.data), [result?.data])
  const rules = useMemo(() => parseRules(resultData), [resultData])
  const violations = useMemo(() => parseViolations(resultData), [resultData])
  const highViolations = useMemo(() => violations.filter(item => item.severity === 'high').length, [violations])
  const scanState = useMemo(() => {
    if (runningAction) return 'warning'
    if (error || highViolations > 0) return 'danger'
    if (result?.success || status?.scriptExists) return 'ready'
    return 'warning'
  }, [error, highViolations, result?.success, runningAction, status?.scriptExists])

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
      if (!response.ok) throw new Error(body?.error || 'Failed to load Hermes boundary status')
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

  async function runBoundaryAction(action: BoundaryAction) {
    setRunningAction(action)
    setError('')
    setResult(null)

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          sessionsDir,
          rulesPath,
          driftThreshold,
          maxViolations,
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
              <span className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">H-02</span>
              <h1 className="text-2xl font-semibold text-foreground">Hermes Boundary Watchdog</h1>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Watches boundary-rules.json, scans sessions, and highlights drift or forbidden output.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading}>Refresh</Button>
            {(['check', 'scan'] as BoundaryAction[]).map(action => (
              <Button
                key={action}
                size="sm"
                variant={action === 'scan' ? 'success' : 'default'}
                disabled={Boolean(runningAction)}
                onClick={() => runBoundaryAction(action)}
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
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status?.scriptExists ? 'ready' : 'danger')}`} />
            <h2 className="text-lg font-semibold">Script</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{status?.scriptExists ? 'Ready' : 'Missing'}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(scanState)}`} />
            <h2 className="text-lg font-semibold">扫描结果</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{violations.length} violations</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Drift</h2>
          <p className="mt-2 text-sm text-muted-foreground">Threshold {driftThreshold.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Rules</h2>
          <p className="mt-2 text-sm text-muted-foreground">{rules.filter(rule => rule.enabled).length}/{rules.length} enabled</p>
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
                <span className="text-xs font-medium text-muted-foreground">Sessions dir</span>
                <input className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" value={sessionsDir} onChange={event => setSessionsDir(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Rules path</span>
                <input className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary/50" value={rulesPath} onChange={event => setRulesPath(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Drift threshold</span>
                <input className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50" type="number" min="0" max="1" step="0.01" value={driftThreshold} onChange={event => setDriftThreshold(Number(event.target.value))} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Max violations</span>
                <input className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50" type="number" min="1" value={maxViolations} onChange={event => setMaxViolations(Number(event.target.value))} />
              </label>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold">Runtime</h2>
            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              <div className="truncate font-mono">Script: {shortPath(status?.scriptPath)}</div>
              <div className="truncate font-mono">Harness: {shortPath(status?.harnessRoot)}</div>
              <div className="truncate font-mono">Tenant: {tenantSlug}</div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">boundary-rules.json</h2>
              <span className="text-xs text-muted-foreground">{rulesPath}</span>
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-background text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Rule</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Pattern</th>
                    <th className="px-3 py-2 font-medium">Severity</th>
                    <th className="px-3 py-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rules.map(rule => (
                    <tr key={rule.id} className="bg-card/60">
                      <td className="px-3 py-2 font-medium text-foreground">{rule.id}</td>
                      <td className="px-3 py-2 text-muted-foreground">{rule.type}</td>
                      <td className="max-w-[320px] truncate px-3 py-2 font-mono text-xs text-muted-foreground">{rule.pattern}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${severityClass(rule.severity)}`}>{rule.severity}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 text-xs ${rule.enabled ? 'text-green-300' : 'text-yellow-300'}`}>
                          <span className={`h-2 w-2 rounded-full ${statusDotClass(rule.enabled ? 'ready' : 'warning')}`} />
                          {rule.enabled ? 'enabled' : 'paused'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold">违规记录</h2>
              <div className="mt-4 space-y-2">
                {violations.length === 0 ? (
                  <div className="rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">No violations returned by the last scan.</div>
                ) : violations.map(item => (
                  <div key={item.id} className="rounded-md border border-border bg-background p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">{item.rule}</div>
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${severityClass(item.severity)}`}>{item.severity}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.session}</div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.excerpt}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold">Raw Result</h2>
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
