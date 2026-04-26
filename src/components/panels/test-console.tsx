'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type TestSuite = 'golden' | 'adversarial' | 'cross-session'
type RunStatus = 'idle' | 'running' | 'completed' | 'failed'
type CaseStatus = 'running' | 'passed' | 'failed'

interface StreamEvent {
  type: string
  run_id?: string
  tenant?: string
  suite?: TestSuite
  total?: number
  index?: number
  case_id?: string
  title?: string
  prompt?: string
  response?: string
  status?: string
  passed?: boolean
  failed?: number
  duration_ms?: number
  http_status?: number | null
  trace_id?: string | null
  error?: string | null
  message?: string
  stream?: string
  output_path?: string
  trace_ids?: string[]
  langfuse?: {
    enabled: boolean
    reason: string
  }
}

interface CaseRun {
  case_id: string
  title: string
  suite: string
  index: number
  prompt: string | null
  response: string | null
  status: CaseStatus
  duration_ms: number | null
  http_status: number | null
  trace_id: string | null
  error: string | null
}

const tenantOptions = [
  'tenant-tg-001',
  'tenant-luo-001-dev',
  'tenant-luo-001',
  'tenant-vinson-001',
  'tenant-lark-001',
]

const suiteButtons: Array<{ id: TestSuite; label: string; expected: string }> = [
  { id: 'golden', label: 'Golden', expected: '10' },
  { id: 'adversarial', label: 'Adversarial', expected: '25' },
  { id: 'cross-session', label: 'Cross-session', expected: '3' },
]

const langfuseBaseUrl = process.env.NEXT_PUBLIC_LANGFUSE_URL || 'http://192.168.1.116:3001'
const langfuseProjectId = process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID || ''
const langfuseTraceTemplate = process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE || ''

const inputClassName = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10'

function formatMs(value: number | null) {
  if (value === null) return '-'
  if (value < 1000) return `${value}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function traceHref(traceId: string) {
  const encoded = encodeURIComponent(traceId)
  if (langfuseTraceTemplate) return langfuseTraceTemplate.replace('{trace_id}', encoded)
  if (langfuseProjectId) return `${langfuseBaseUrl.replace(/\/$/, '')}/project/${encodeURIComponent(langfuseProjectId)}/traces/${encoded}`
  return `${langfuseBaseUrl.replace(/\/$/, '')}/trace/${encoded}`
}

function statusClassName(status: CaseStatus) {
  if (status === 'passed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-300'
  return 'border-primary/30 bg-primary/10 text-primary'
}

function upsertCase(cases: CaseRun[], next: CaseRun) {
  const index = cases.findIndex(item => item.case_id === next.case_id)
  if (index < 0) return [...cases, next].sort((left, right) => left.index - right.index)
  return cases.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item)
}

export function TestConsolePanel() {
  const [tenant, setTenant] = useState('tenant-tg-001')
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [runningSuite, setRunningSuite] = useState<TestSuite | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [runTotal, setRunTotal] = useState(0)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [cases, setCases] = useState<CaseRun[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [traceIds, setTraceIds] = useState<string[]>([])
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const passCount = useMemo(() => cases.filter(testCase => testCase.status === 'passed').length, [cases])
  const failCount = useMemo(() => cases.filter(testCase => testCase.status === 'failed').length, [cases])
  const completedCount = passCount + failCount
  const totalCount = runTotal || cases.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const appendLog = useCallback((line: string) => {
    setLogs(current => [...current.slice(-79), line])
  }, [])

  const applyEvent = useCallback((event: StreamEvent) => {
    if (event.run_id) setRunId(event.run_id)
    if (event.output_path) setOutputPath(event.output_path)
    if (Array.isArray(event.trace_ids)) setTraceIds(event.trace_ids)

    if (event.type === 'run_started') {
      setRunTotal(Number(event.total) || 0)
      setRunStatus('running')
      appendLog(`loaded ${event.total || 0} cases`)
      return
    }

    if (event.type === 'case_started' && event.case_id) {
      setCases(current => upsertCase(current, {
        case_id: event.case_id || '',
        title: event.title || event.case_id || '',
        suite: String(event.suite || runningSuite || ''),
        index: Number(event.index) || current.length + 1,
        prompt: null,
        response: null,
        status: 'running',
        duration_ms: null,
        http_status: null,
        trace_id: null,
        error: null,
      }))
      return
    }

    if (event.type === 'case_finished' && event.case_id) {
      setCases(current => upsertCase(current, {
        case_id: event.case_id || '',
        title: event.title || event.case_id || '',
        suite: String(event.suite || runningSuite || ''),
        index: Number(event.index) || current.length + 1,
        prompt: event.prompt || null,
        response: event.response || null,
        status: event.passed ? 'passed' : 'failed',
        duration_ms: typeof event.duration_ms === 'number' ? event.duration_ms : null,
        http_status: typeof event.http_status === 'number' ? event.http_status : null,
        trace_id: event.trace_id || null,
        error: event.error || null,
      }))
      return
    }

    if (event.type === 'run_finished') {
      setRunTotal(Number(event.total) || totalCount)
      setRunStatus(Number(event.failed) > 0 ? 'failed' : 'completed')
      return
    }

    if (event.type === 'process_closed') {
      setRunStatus(event.status === 'completed' ? 'completed' : 'failed')
      return
    }

    if (event.type === 'run_error') {
      setRunStatus('failed')
      setError(event.error || 'Runner failed')
      return
    }

    if (event.type === 'log' && event.message) {
      appendLog(event.message)
    }
  }, [appendLog, runningSuite, totalCount])

  const runSuite = useCallback(async (suite: TestSuite) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunStatus('running')
    setRunningSuite(suite)
    setRunId(null)
    setRunTotal(0)
    setOutputPath(null)
    setCases([])
    setLogs([])
    setTraceIds([])
    setSelectedCaseId(null)
    setError(null)

    try {
      const response = await fetch('/api/harness/run-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant, suite }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || `Request failed with ${response.status}`)
      }
      if (!response.body) throw new Error('Response stream unavailable')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          applyEvent(JSON.parse(line) as StreamEvent)
        }
      }

      buffer += decoder.decode()
      if (buffer.trim()) applyEvent(JSON.parse(buffer) as StreamEvent)
    } catch (runError: any) {
      if (runError?.name === 'AbortError') return
      setRunStatus('failed')
      setError(runError?.message || 'Failed to start test run')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunningSuite(null)
    }
  }, [applyEvent, tenant])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card/70 p-5 shadow-sm xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">Tests</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border px-2.5 py-1">run: {runId || '-'}</span>
            <span className="rounded-md border border-border px-2.5 py-1">status: {runStatus}</span>
            <span className="rounded-md border border-border px-2.5 py-1">traces: {traceIds.length}</span>
          </div>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-[minmax(180px,260px)_1fr] xl:w-auto xl:min-w-[680px]">
          <label className="min-w-0">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tenant</span>
            <select
              className={inputClassName}
              value={tenant}
              onChange={(event) => setTenant(event.target.value)}
              disabled={runStatus === 'running'}
            >
              {tenantOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>

          <div className="min-w-0">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suite</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {suiteButtons.map(button => (
                <Button
                  key={button.id}
                  variant={runningSuite === button.id ? 'default' : 'outline'}
                  onClick={() => runSuite(button.id)}
                  disabled={runStatus === 'running'}
                  className="h-10 justify-between px-3"
                >
                  <span>{button.label}</span>
                  <span className="text-xs opacity-70">{button.expected}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border px-2.5 py-1">total: {totalCount}</span>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">pass: {passCount}</span>
            <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-300">fail: {failCount}</span>
            {outputPath && <span className="max-w-full truncate rounded-md border border-border px-2.5 py-1">report: {outputPath}</span>}
          </div>
          <span className="text-xs font-medium text-muted-foreground">{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </section>

      <div className="grid min-h-[58vh] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
        <section className="rounded-lg border border-border bg-card/70 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Cases</h2>
            <span className="text-xs text-muted-foreground">{completedCount} / {totalCount || 0}</span>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Case</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">HTTP</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background/40">
                {cases.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      No run selected.
                    </td>
                  </tr>
                )}
                {cases.map(testCase => {
                  const isSelected = selectedCaseId === testCase.case_id

                  return (
                    <Fragment key={testCase.case_id}>
                      <tr
                        className={`cursor-pointer align-top transition hover:bg-secondary/30 ${isSelected ? 'bg-secondary/30' : ''}`}
                        onClick={() => setSelectedCaseId(current => current === testCase.case_id ? null : testCase.case_id)}
                      >
                        <td className="px-3 py-3">
                          <div className="font-medium text-foreground">{testCase.case_id}</div>
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{testCase.title}</div>
                          {testCase.error && <div className="mt-2 text-xs text-red-300">{testCase.error}</div>}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-md border px-2 py-1 text-xs ${statusClassName(testCase.status)}`}>
                            {testCase.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{testCase.http_status ?? '-'}</td>
                        <td className="px-3 py-3 text-muted-foreground">{formatMs(testCase.duration_ms)}</td>
                        <td className="px-3 py-3">
                          {testCase.trace_id ? (
                            <a
                              href={traceHref(testCase.trace_id)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                            >
                              {testCase.trace_id.slice(0, 12)}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                      {isSelected && (
                        <tr className="bg-background/70">
                          <td colSpan={5} className="px-3 pb-4">
                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="min-w-0">
                                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prompt</div>
                                <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background/80 p-3 whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
                                  {testCase.prompt || 'Waiting for prompt...'}
                                </pre>
                              </div>
                              <div className="min-w-0">
                                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Response</div>
                                <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background/80 p-3 whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
                                  {testCase.response || testCase.error || 'Waiting for response...'}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card/70 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Runner</h2>
            <span className="text-xs text-muted-foreground">{logs.length}</span>
          </div>
          <pre className="h-[calc(58vh-3.25rem)] min-h-[320px] overflow-auto rounded-lg border border-border bg-background/80 p-3 text-xs leading-5 text-muted-foreground">
            {logs.length ? logs.join('\n') : 'No runner output.'}
          </pre>
        </section>
      </div>
    </div>
  )
}
