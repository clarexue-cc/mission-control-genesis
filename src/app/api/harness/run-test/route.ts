import { NextRequest, NextResponse } from 'next/server'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ApiSuite = 'golden' | 'adversarial' | 'cross-session'
type RunnerSuite = 'Golden' | 'Adversarial' | 'Cross-session'

interface RunTestBody {
  tenant?: unknown
  suite?: unknown
  delay_ms?: unknown
  timeout_ms?: unknown
}

interface StreamEvent {
  type: string
  run_id: string
  trace_ids?: string[]
  [key: string]: unknown
}

const SUITE_MAP: Record<ApiSuite, RunnerSuite> = {
  golden: 'Golden',
  adversarial: 'Adversarial',
  'cross-session': 'Cross-session',
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function normalizeTenant(value: unknown): string {
  const tenant = typeof value === 'string' ? value.trim() : ''
  if (!/^[a-z0-9-]+$/.test(tenant)) {
    throw new Error('tenant must contain only lowercase letters, numbers, and hyphens')
  }
  return tenant
}

function normalizeSuite(value: unknown): ApiSuite {
  const suite = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (suite === 'golden' || suite === 'adversarial' || suite === 'cross-session') {
    return suite
  }
  throw new Error('suite must be golden, adversarial, or cross-session')
}

function normalizeMs(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.trunc(number), min), max)
}

function makeRunId(suite: ApiSuite) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').toLowerCase()
  return `mc-${timestamp}-${suite}-${randomBytes(3).toString('hex')}`
}

async function resolveHarnessRoot(): Promise<string | null> {
  const candidates = [
    process.env.MC_HARNESS_ROOT,
    process.env.GENESIS_HARNESS_ROOT,
    '/Users/clare/Desktop/genesis-harness',
    path.resolve(process.cwd(), '..', 'genesis-harness'),
    path.resolve(process.cwd(), 'genesis-harness'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  return null
}

async function resolveRunnerPath(harnessRoot: string): Promise<string | null> {
  const candidates = [
    process.env.MC_HARNESS_TEST_RUNNER,
    path.join(harnessRoot, 'phase0/tools/tg-test-runner.ts'),
    path.join(harnessRoot, 'tools/tg-test-runner.ts'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  return null
}

function writeJson(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: StreamEvent) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
}

function parseRunnerLine(line: string): unknown | null {
  const prefix = '[runner:event] '
  if (!line.startsWith(prefix)) return null
  try {
    return JSON.parse(line.slice(prefix.length))
  } catch {
    return null
  }
}

function pipeLines(
  child: ChildProcessWithoutNullStreams,
  streamName: 'stdout' | 'stderr',
  onLine: (line: string, streamName: 'stdout' | 'stderr') => void,
) {
  let buffer = ''
  child[streamName].setEncoding('utf8')
  child[streamName].on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onLine(line, streamName)
    }
  })
  child[streamName].on('end', () => {
    if (buffer.trim()) onLine(buffer, streamName)
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null) as RunTestBody | null

  let tenant: string
  let suite: ApiSuite
  try {
    tenant = normalizeTenant(body?.tenant)
    suite = normalizeSuite(body?.suite)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Invalid request' }, { status: 400 })
  }

  const harnessRoot = await resolveHarnessRoot()
  if (!harnessRoot) {
    return NextResponse.json({ error: 'Genesis harness root not found' }, { status: 404 })
  }

  const runnerPath = await resolveRunnerPath(harnessRoot)
  if (!runnerPath) {
    return NextResponse.json({ error: 'tg-test-runner.ts not found' }, { status: 404 })
  }

  const runId = makeRunId(suite)
  const resultsDir = path.join(harnessRoot, 'phase0/tests/results')
  await mkdir(resultsDir, { recursive: true })
  const outputPath = path.join(resultsDir, `${runId}.md`)
  const delayMs = normalizeMs(body?.delay_ms, 1000, 0, 60_000)
  const timeoutMs = normalizeMs(body?.timeout_ms, 30_000, 1_000, 300_000)
  const traceIds = new Set<string>()
  let child: ChildProcessWithoutNullStreams | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      const send = (event: StreamEvent) => {
        if (!closed) writeJson(controller, encoder, event)
      }
      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }

      send({
        type: 'run_accepted',
        run_id: runId,
        tenant,
        suite,
        runner_suite: SUITE_MAP[suite],
        runner_path: runnerPath,
        output_path: outputPath,
        trace_ids: [],
      })

      const runProcess = spawn(process.execPath, [
        runnerPath,
        '--tenant',
        tenant,
        '--suite',
        SUITE_MAP[suite],
        '--output',
        outputPath,
        '--delay-ms',
        String(delayMs),
        '--timeout-ms',
        String(timeoutMs),
      ], {
        cwd: harnessRoot,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      runProcess.stdin.end()
      child = runProcess

      const emitLine = (line: string, streamName: 'stdout' | 'stderr') => {
        const runnerEvent = parseRunnerLine(line)
        if (runnerEvent && typeof runnerEvent === 'object') {
          const event = runnerEvent as Record<string, unknown>
          const traceId = typeof event.trace_id === 'string' ? event.trace_id : null
          if (traceId) traceIds.add(traceId)
          if (Array.isArray(event.trace_ids)) {
            for (const id of event.trace_ids) {
              if (typeof id === 'string') traceIds.add(id)
            }
          }
          send({
            ...event,
            type: String(event.type || 'runner_event'),
            run_id: runId,
            trace_ids: Array.from(traceIds),
          })
          return
        }

        send({
          type: 'log',
          run_id: runId,
          stream: streamName,
          message: line,
          trace_ids: Array.from(traceIds),
        })
      }

      pipeLines(runProcess, 'stdout', emitLine)
      pipeLines(runProcess, 'stderr', emitLine)

      runProcess.on('error', (error) => {
        send({
          type: 'run_error',
          run_id: runId,
          error: error.message,
          trace_ids: Array.from(traceIds),
        })
        close()
      })

      runProcess.on('close', (code, signal) => {
        send({
          type: 'process_closed',
          run_id: runId,
          status: code === 0 ? 'completed' : 'failed',
          exit_code: code,
          signal,
          output_path: outputPath,
          trace_ids: Array.from(traceIds),
        })
        close()
      })
    },
    cancel() {
      child?.kill('SIGTERM')
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Run-Id': runId,
    },
  })
}
