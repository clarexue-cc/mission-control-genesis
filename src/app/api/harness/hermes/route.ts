import { existsSync, readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runCommand } from '@/lib/command'
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

const VAULT_ROOT = process.env.MC_OBSIDIAN_VAULT_ROOT || process.env.OBSIDIAN_VAULT_ROOT || '/Users/clare/Desktop/obsidian/openclaw'
const STALE_SECONDS = Number.parseInt(process.env.HERMES_STALE_SECONDS || `${6 * 60 * 60}`, 10)
const RUNTIME_DIR = process.env.HERMES_RUNTIME_DIR || path.join(process.env.TMPDIR || '/tmp', 'mission-control-hermes')
const PID_FILE = process.env.HERMES_DAEMON_PID_FILE || path.join(RUNTIME_DIR, 'hermes-daemon.pid')
const LOG_FILE = process.env.HERMES_LOG_FILE || path.join(VAULT_ROOT, 'Agent-Shared', 'hermes-log.md')
const ALERTS_FILE = process.env.HERMES_ALERTS_FILE || path.join(VAULT_ROOT, 'Agent-Shared', 'hermes-alerts.jsonl')

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
