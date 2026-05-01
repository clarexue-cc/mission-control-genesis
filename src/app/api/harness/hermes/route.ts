import { existsSync, readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runCommand } from '@/lib/command'
import { getHermesTasks } from '@/lib/hermes-tasks'
import { isCustomerRole, readRoleFromCookieString } from '@/lib/rbac'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface HermesTargetStatus {
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

interface HermesCronEvidenceJob {
  id: string
  schedule: string
  enabled: boolean
  lastRunAt: string | null
  runCount: number
  evidence: string
}

interface HermesConfigSummary {
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

const VAULT_ROOT = process.env.MC_OBSIDIAN_VAULT_ROOT || process.env.OBSIDIAN_VAULT_ROOT || '/Users/clare/Desktop/obsidian/openclaw'
const STALE_SECONDS = Number.parseInt(process.env.HERMES_STALE_SECONDS || `${6 * 60 * 60}`, 10)
const RUNTIME_DIR = process.env.HERMES_RUNTIME_DIR || path.join(process.env.TMPDIR || '/tmp', 'mission-control-hermes')
const PID_FILE = process.env.HERMES_DAEMON_PID_FILE || path.join(RUNTIME_DIR, 'hermes-daemon.pid')
const LOG_FILE = process.env.HERMES_LOG_FILE || path.join(VAULT_ROOT, 'Agent-Shared', 'hermes-log.md')
const ALERTS_FILE = process.env.HERMES_ALERTS_FILE || path.join(VAULT_ROOT, 'Agent-Shared', 'hermes-alerts.jsonl')
const HERMES_HOME = process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes')
const HERMES_CONFIG_FILE = process.env.HERMES_CONFIG_FILE || path.join(HERMES_HOME, 'config.yaml')
const HERMES_SOUL_FILE = process.env.HERMES_SOUL_FILE || path.join(HERMES_HOME, 'SOUL.md')
const HERMES_AGENTS_FILE = process.env.HERMES_AGENTS_FILE || path.join(HERMES_HOME, 'AGENTS.md')
const HERMES_CRON_JOBS_FILE = process.env.HERMES_CRON_JOBS_FILE || path.join(HERMES_HOME, 'cron', 'jobs.json')

function scriptPath(name: string): string {
  return path.join(process.cwd(), 'phase0', 'scripts', name)
}

function readPid(): number | null {
  try {
    const raw = readFileSync(PID_FILE, 'utf8').trim()
    const pid = Number.parseInt(raw, 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

function isProcessRunning(pid: number | null): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLogTail(maxLines = 160): string {
  try {
    return readFileSync(LOG_FILE, 'utf8').split('\n').slice(-maxLines).join('\n').trim()
  } catch {
    return ''
  }
}

function parseLogForAgent(agentDir: string, logTail: string): { lastCheckAt: string | null; lastAlert: string | null } {
  const lines = logTail.split('\n').filter(line => line.includes(`| ${agentDir} |`))
  const lastLine = lines.at(-1) || ''
  const alertLine = [...lines].reverse().find(line => line.includes('| ALERT |')) || ''
  const lastCheckAt = lastLine.match(/^- ([^|]+) \|/)?.[1]?.trim() || null
  return {
    lastCheckAt,
    lastAlert: alertLine || null,
  }
}

function displayTenant(agentDir: string): string {
  return agentDir.replace(/^Agent-/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

function cronJobEvidenceText(job: { id: string; prompt: string; schedule: string }) {
  return `${job.id} ${job.prompt} ${job.schedule}`.toLowerCase()
}

function cleanYamlValue(value: string): string {
  const withoutComment = value.replace(/\s+#.*$/, '').trim()
  if (
    (withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
    (withoutComment.startsWith("'") && withoutComment.endsWith("'"))
  ) {
    return withoutComment.slice(1, -1)
  }
  return withoutComment
}

function extractYamlScalar(raw: string, section: string, key: string): string | null {
  let inSection = false
  for (const rawLine of raw.split('\n')) {
    const topLevel = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine)
    if (topLevel && !rawLine.startsWith(' ')) {
      inSection = topLevel[1] === section
      continue
    }
    if (!inSection) continue
    const match = new RegExp(`^\\s+${key}:\\s*(.*)$`).exec(rawLine)
    if (match) return cleanYamlValue(match[1])
  }
  return null
}

function extractYamlList(raw: string, section: string): string[] {
  let inSection = false
  const values: string[] = []
  for (const rawLine of raw.split('\n')) {
    const topLevel = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine)
    if (topLevel && !rawLine.startsWith(' ')) {
      inSection = topLevel[1] === section
      continue
    }
    if (!inSection) continue
    const match = /^\s+-\s+(.*)$/.exec(rawLine)
    if (match) values.push(cleanYamlValue(match[1]))
  }
  return values
}

function parseConfigNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseConfigBoolean(value: string | null): boolean | null {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function readHermesConfig(): string | null {
  try {
    return readFileSync(HERMES_CONFIG_FILE, 'utf8')
  } catch {
    return null
  }
}

function getHermesConfigSummary(): HermesConfigSummary {
  const raw = readHermesConfig()
  return {
    config_path: HERMES_CONFIG_FILE,
    config_exists: Boolean(raw),
    soul_path: HERMES_SOUL_FILE,
    soul_exists: existsSync(HERMES_SOUL_FILE),
    agents_path: HERMES_AGENTS_FILE,
    agents_exists: existsSync(HERMES_AGENTS_FILE),
    cron_jobs_path: HERMES_CRON_JOBS_FILE,
    cron_jobs_exists: existsSync(HERMES_CRON_JOBS_FILE),
    provider: raw ? extractYamlScalar(raw, 'model', 'provider') : null,
    model: raw ? extractYamlScalar(raw, 'model', 'default') : null,
    base_url: raw ? extractYamlScalar(raw, 'model', 'base_url') : null,
    toolsets: raw ? extractYamlList(raw, 'toolsets') : [],
    max_turns: raw ? parseConfigNumber(extractYamlScalar(raw, 'agent', 'max_turns')) : null,
    gateway_timeout: raw ? parseConfigNumber(extractYamlScalar(raw, 'agent', 'gateway_timeout')) : null,
    terminal_backend: raw ? extractYamlScalar(raw, 'terminal', 'backend') : null,
    terminal_cwd: raw ? extractYamlScalar(raw, 'terminal', 'cwd') : null,
    browser_private_urls: raw ? parseConfigBoolean(extractYamlScalar(raw, 'browser', 'allow_private_urls')) : null,
  }
}

function getCronEvidence() {
  const cronJobs = getHermesTasks(true).cronJobs
  const jobs: HermesCronEvidenceJob[] = cronJobs.map(job => {
    const evidence = cronJobEvidenceText(job)
    return {
      id: job.id,
      schedule: job.schedule,
      enabled: job.enabled,
      lastRunAt: job.lastRunAt,
      runCount: job.runCount,
      evidence,
    }
  })
  const enabledJobs = jobs.filter(job => job.enabled)
  const openclawMonitoring = enabledJobs.some(job => job.evidence.includes('openclaw'))
  const heartbeatMonitoring = enabledJobs.some(job => job.evidence.includes('heartbeat') || job.evidence.includes('working-context'))
  const lastRunAt = enabledJobs
    .map(job => job.lastRunAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null

  return {
    total_jobs: jobs.length,
    enabled_jobs: enabledJobs.length,
    openclaw_monitoring: openclawMonitoring,
    heartbeat_monitoring: heartbeatMonitoring,
    last_run_at: lastRunAt,
    evidence: jobs.length > 0
      ? `${enabledJobs.length}/${jobs.length} Hermes cron jobs enabled`
      : 'No Hermes cron jobs found under ~/.hermes/cron/jobs.json',
    jobs,
  }
}

async function listAgentDirs(): Promise<string[]> {
  const entries = await readdir(VAULT_ROOT, { withFileTypes: true }).catch(() => [])
  return entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('Agent-') && entry.name !== 'Agent-Shared' && entry.name !== 'Agent-TEMPLATE')
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

async function getHermesState() {
  const pid = readPid()
  const daemonRunning = isProcessRunning(pid)
  const logTail = readLogTail()
  const now = Date.now()
  const agentDirs = await listAgentDirs()
  const targets: HermesTargetStatus[] = []

  for (const agentDir of agentDirs) {
    const contextPath = path.join(VAULT_ROOT, agentDir, 'working-context.md')
    const stats = await stat(contextPath).catch(() => null)
    const heartbeatAgeSeconds = stats ? Math.max(0, Math.floor((now - stats.mtime.getTime()) / 1000)) : null
    const health: HermesTargetStatus['health'] = !stats
      ? 'missing'
      : heartbeatAgeSeconds !== null && heartbeatAgeSeconds > STALE_SECONDS
        ? 'stale'
        : 'fresh'
    const parsed = parseLogForAgent(agentDir, logTail)
    targets.push({
      tenant: displayTenant(agentDir),
      agent_dir: agentDir,
      health,
      context_path: contextPath,
      context_exists: Boolean(stats),
      heartbeat_age_seconds: heartbeatAgeSeconds,
      last_heartbeat_at: stats ? stats.mtime.toISOString() : null,
      last_check_at: parsed.lastCheckAt,
      last_alert: parsed.lastAlert,
      stale: health !== 'fresh',
    })
  }

  return {
    daemon_running: daemonRunning,
    pid,
    stale_seconds: STALE_SECONDS,
    vault_root: VAULT_ROOT,
    log_path: LOG_FILE,
    log_tail: logTail,
    config: getHermesConfigSummary(),
    cron: getCronEvidence(),
    targets,
    scripts: {
      daemon: scriptPath('hermes-daemon.sh'),
      heartbeat: scriptPath('agent-heartbeat.sh'),
    },
  }
}

async function runHermesScript(script: string, args: string[]) {
  if (!existsSync(script)) throw new Error(`${path.basename(script)} not found`)
  return runCommand('bash', [script, ...args], {
    timeoutMs: 20_000,
    env: {
      ...process.env,
      OBSIDIAN_VAULT_ROOT: VAULT_ROOT,
      HERMES_STALE_SECONDS: String(STALE_SECONDS),
      HERMES_DAEMON_PID_FILE: PID_FILE,
      HERMES_LOG_FILE: LOG_FILE,
      HERMES_ALERTS_FILE: ALERTS_FILE,
    },
  })
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (isCustomerRole(readRoleFromCookieString(request.headers.get('cookie')))) {
    return NextResponse.json({ error: 'Customer role cannot access Hermes internals' }, { status: 403 })
  }

  try {
    return NextResponse.json(await getHermesState(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load Hermes state' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (isCustomerRole(readRoleFromCookieString(request.headers.get('cookie')))) {
    return NextResponse.json({ error: 'Customer role cannot access Hermes internals' }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const action = typeof body?.action === 'string' ? body.action : ''
    const daemonScript = scriptPath('hermes-daemon.sh')
    const heartbeatScript = scriptPath('agent-heartbeat.sh')

    if (action === 'start') {
      await runHermesScript(daemonScript, ['start'])
    } else if (action === 'stop') {
      await runHermesScript(daemonScript, ['stop'])
    } else if (action === 'check') {
      await runHermesScript(daemonScript, ['check'])
    } else if (action === 'heartbeat') {
      const agentDir = typeof body?.agent_dir === 'string' ? body.agent_dir : 'Agent-Hermes'
      await runHermesScript(heartbeatScript, [agentDir, 'manual heartbeat from Mission Control'])
    } else {
      return NextResponse.json({ error: 'action must be start, stop, check, or heartbeat' }, { status: 400 })
    }

    return NextResponse.json({ success: true, state: await getHermesState() })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Hermes action failed' }, { status: 500 })
  }
}
