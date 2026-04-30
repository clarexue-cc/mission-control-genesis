import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { resolveWithin } from '@/lib/paths'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RunnerSuite = 'Golden' | 'Adversarial' | 'Cross-session' | 'Drift'
type HealthStatus = 'ready' | 'warning' | 'blocked'
type CheckStatus = 'pass' | 'warn' | 'fail'

interface RunnerCase {
  suite: RunnerSuite
  testId: string
  title: string
  prompt: string
}

interface RunnerListPayload {
  tenant: string
  template: string
  total: number
  cases: RunnerCase[]
}

interface HealthCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  action?: string
}

interface RuntimeContainer {
  name: string
  command: string
  status: CheckStatus
  detail: string
  running: boolean
  health: string | null
}

const SUITES: Array<{
  id: string
  label: RunnerSuite
  expected: number
  files: string[]
}> = [
  { id: 'golden', label: 'Golden', expected: 10, files: ['golden-10-cc.md', 'golden-test-cases.md'] },
  { id: 'adversarial', label: 'Adversarial', expected: 25, files: ['adversarial-25-cc.md', 'adversarial-20-cc.md'] },
  { id: 'cross-session', label: 'Cross-session', expected: 3, files: ['cross-session-3-cc.md', 'cross-session-memory-3-cc.md'] },
  { id: 'drift', label: 'Drift', expected: 8, files: ['drift-8-cc.md', 'drift-6-cc.md'] },
]

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

async function resolveRunnerPath(harnessRoot: string): Promise<string | null> {
  const candidates = [
    process.env.MC_HARNESS_TEST_RUNNER,
    resolveWithin(harnessRoot, 'phase0/tools/tg-test-runner.ts'),
    resolveWithin(harnessRoot, 'tools/tg-test-runner.ts'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  return null
}

function parseRunnerJson(stdout: string): RunnerListPayload {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('runner did not return JSON')
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as RunnerListPayload
  if (!Array.isArray(parsed.cases)) throw new Error('runner JSON missing cases')
  return parsed
}

function runListCases(harnessRoot: string, runnerPath: string, tenant: string): Promise<RunnerListPayload> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      runnerPath,
      '--tenant',
      tenant,
      '--suite',
      'all',
      '--list-cases',
      '--json',
    ], {
      cwd: harnessRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('runner list-cases timed out'))
    }, 15_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(stderr.trim() || `runner exited with ${code}`))
        return
      }
      try {
        resolve(parseRunnerJson(stdout))
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function findSuiteFile(harnessRoot: string, template: string, files: string[]) {
  for (const file of files) {
    const relativePath = `phase0/templates/${template}/tests/${file}`
    if (await exists(resolveWithin(harnessRoot, relativePath))) {
      return { path: relativePath, exists: true }
    }
  }
  return { path: `phase0/templates/${template}/tests/${files[0]}`, exists: false }
}

async function findLatestReport(harnessRoot: string) {
  const resultsDir = resolveWithin(harnessRoot, 'phase0/tests/results')
  try {
    const entries = await readdir(resultsDir)
    const reports = await Promise.all(entries.filter(name => name.endsWith('.md')).map(async name => {
      const filePath = path.join(resultsDir, name)
      const stats = await stat(filePath)
      return { path: filePath, mtimeMs: stats.mtimeMs }
    }))
    reports.sort((left, right) => right.mtimeMs - left.mtimeMs)
    const latest = reports[0]
    if (!latest) return null
    return {
      path: latest.path,
      updated_at: new Date(latest.mtimeMs).toISOString(),
    }
  } catch {
    return null
  }
}

function overallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some(check => check.status === 'fail')) return 'blocked'
  if (checks.some(check => check.status === 'warn')) return 'warning'
  return 'ready'
}

function inspectRuntimeContainer(tenant: string): Promise<RuntimeContainer> {
  const command = `docker exec ${tenant}`
  const dockerBin = process.env.MC_HARNESS_DOCKER_BIN || 'docker'

  return new Promise(resolve => {
    const child = spawn(dockerBin, ['inspect', tenant], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (container: RuntimeContainer) => {
      if (settled) return
      settled = true
      resolve(container)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({
        name: tenant,
        command,
        status: 'fail',
        detail: 'docker inspect timed out',
        running: false,
        health: null,
      })
    }, 5_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      finish({
        name: tenant,
        command,
        status: 'fail',
        detail: error.message,
        running: false,
        health: null,
      })
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        finish({
          name: tenant,
          command,
          status: 'fail',
          detail: stderr.trim() || `docker inspect exited with ${code}`,
          running: false,
          health: null,
        })
        return
      }

      try {
        const parsed = JSON.parse(stdout) as Array<{ State?: { Running?: boolean; Health?: { Status?: string } } }>
        const state = parsed[0]?.State
        const running = state?.Running === true
        const health = typeof state?.Health?.Status === 'string' ? state.Health.Status : null
        if (!running) {
          finish({
            name: tenant,
            command,
            status: 'fail',
            detail: `${tenant} container is not running`,
            running: false,
            health,
          })
          return
        }
        if (health && health !== 'healthy') {
          finish({
            name: tenant,
            command,
            status: health === 'starting' ? 'warn' : 'fail',
            detail: `${tenant} container health is ${health}`,
            running: true,
            health,
          })
          return
        }
        finish({
          name: tenant,
          command,
          status: 'pass',
          detail: health ? `${tenant} is running and ${health}` : `${tenant} is running`,
          running: true,
          health,
        })
      } catch (error: any) {
        finish({
          name: tenant,
          command,
          status: 'fail',
          detail: error?.message || 'docker inspect returned invalid JSON',
          running: false,
          health: null,
        })
      }
    })
  })
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let tenant: string
  try {
    tenant = normalizeTenant(request.nextUrl.searchParams.get('tenant') || 'ceo-assistant-v1')
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Invalid request' }, { status: 400 })
  }

  const checks: HealthCheck[] = []
  let harnessRoot = ''
  let runnerPath: string | null = null
  let runner: RunnerListPayload | null = null
  const runtimeTarget = `docker exec ${tenant}`

  try {
    harnessRoot = await resolveHarnessRoot()
    checks.push({ id: 'harness_root', label: 'Harness root', status: 'pass', detail: harnessRoot })
  } catch (error: any) {
    checks.push({
      id: 'harness_root',
      label: 'Harness root',
      status: 'fail',
      detail: error?.message || 'Genesis harness root not found',
      action: 'Set MC_HARNESS_ROOT / GENESIS_HARNESS_ROOT or place genesis-harness next to MC.',
    })
    return NextResponse.json({ status: 'blocked', tenant, template: null, total_cases: 0, harness_root: null, runner_path: null, runtime_target: runtimeTarget, container: null, suites: [], checks, latest_report: null })
  }

  runnerPath = await resolveRunnerPath(harnessRoot)
  if (!runnerPath) {
    checks.push({
      id: 'runner_path',
      label: 'Runner path',
      status: 'fail',
      detail: 'tg-test-runner.ts not found',
      action: 'Restore tools/tg-test-runner.ts or configure MC_HARNESS_TEST_RUNNER.',
    })
    return NextResponse.json({ status: 'blocked', tenant, template: null, total_cases: 0, harness_root: harnessRoot, runner_path: null, runtime_target: runtimeTarget, container: null, suites: [], checks, latest_report: await findLatestReport(harnessRoot) })
  }
  checks.push({ id: 'runner_path', label: 'Runner path', status: 'pass', detail: runnerPath })

  try {
    runner = await runListCases(harnessRoot, runnerPath, tenant)
    checks.push({ id: 'runner_parse', label: 'Runner list-cases', status: 'pass', detail: `Parsed ${runner.total} cases for template ${runner.template}` })
  } catch (error: any) {
    checks.push({
      id: 'runner_parse',
      label: 'Runner list-cases',
      status: 'fail',
      detail: error?.message || 'Runner failed to parse cases',
      action: 'Fix tools/tg-test-runner.ts or the template tests files before running P10.',
    })
    return NextResponse.json({ status: 'blocked', tenant, template: null, total_cases: 0, harness_root: harnessRoot, runner_path: runnerPath, runtime_target: runtimeTarget, container: null, suites: [], checks, latest_report: await findLatestReport(harnessRoot) })
  }

  const container = await inspectRuntimeContainer(tenant)
  checks.push({
    id: 'runtime_container',
    label: 'Runtime container',
    status: container.status,
    detail: container.detail,
    action: container.status === 'pass' ? undefined : 'Start or map the tenant container before running P10.',
  })

  const templateRoot = resolveWithin(harnessRoot, `phase0/templates/${runner.template}`)
  const templateExists = await exists(templateRoot)
  checks.push({
    id: 'template_root',
    label: 'Template root',
    status: templateExists ? 'pass' : 'fail',
    detail: `phase0/templates/${runner.template}`,
    action: templateExists ? undefined : 'Create or restore the selected template directory.',
  })

  const suites = await Promise.all(SUITES.map(async suite => {
    const actual = runner.cases.filter(testCase => testCase.suite === suite.label).length
    const file = await findSuiteFile(harnessRoot, runner!.template, suite.files)
    const status: CheckStatus = !file.exists ? 'fail' : actual === suite.expected ? 'pass' : 'warn'
    checks.push({
      id: `${suite.id}_suite`,
      label: `${suite.label} suite`,
      status,
      detail: `${actual}/${suite.expected} cases · ${file.path}`,
      action: status === 'pass' ? undefined : `Fix ${file.path} or runner case parsing for ${suite.label}.`,
    })
    return {
      id: suite.id,
      label: suite.label,
      expected: suite.expected,
      actual,
      status,
      file: file.path,
    }
  }))

  return NextResponse.json({
    status: overallStatus(checks),
    tenant: runner.tenant || tenant,
    template: runner.template,
    total_cases: runner.total,
    harness_root: harnessRoot,
    runner_path: runnerPath,
    runtime_target: runtimeTarget,
    container,
    suites,
    checks,
    latest_report: await findLatestReport(harnessRoot),
  })
}
