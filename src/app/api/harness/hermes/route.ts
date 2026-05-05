import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runCommand } from '@/lib/command'
import { getHermesTasks } from '@/lib/hermes-tasks'
import { isCustomerRole, readRoleFromCookieString } from '@/lib/rbac'
import { normalizeTenantId } from '@/lib/tenant-id'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface HermesTargetStatus {
  tenant: string
  tenant_id: string | null
  agent_dir: string
  health: 'fresh' | 'stale' | 'missing'
  severity: 'healthy' | 'warning' | 'critical' | 'missing'
  reason: string
  context_path: string
  context_exists: boolean
  heartbeat_age_seconds: number | null
  last_heartbeat_at: string | null
  last_check_at: string | null
  last_alert: string | null
  container: HermesTenantRuntime | null
  stale: boolean
}

interface HermesCronEvidenceJob {
  id: string
  name: string
  schedule: string
  enabled: boolean
  prompt: string
  lastRunAt: string | null
  runCount: number
  evidence: string
}

interface HermesCronAllowlistSummary {
  path: string
  exists: boolean
  job_ids: string[]
}

interface HermesTenantRuntime {
  tenant: string
  status: 'running' | 'stopped' | 'missing' | 'network-error' | 'unknown'
  severity: 'healthy' | 'warning' | 'critical'
  detail: string
}

interface HermesInspectionSummary {
  last_run_at: string | null
}

interface HermesRepairHistoryItem {
  timestamp: string
  action_type: 'restart_container' | 'cleanup_stale' | 'send_alert'
  target_agent: string
  result: 'success' | 'failure'
  detail: string
  source: 'inspection-log' | 'alerts-jsonl'
}

interface HermesCronJobPayload {
  id?: unknown
  name?: unknown
  schedule?: unknown
  prompt?: unknown
  enabled?: unknown
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
  cron_allowlist_path: string
  cron_allowlist_exists: boolean
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

interface HermesSetupStep {
  id: 'config-yaml' | 'soul-md' | 'agents-md' | 'cron-jobs' | 'cron-allowlist'
  label: string
  status: 'ready' | 'warning' | 'missing'
  detail: string
}

interface HermesSetupSummary {
  ready: boolean
  status: 'ready' | 'needs-attention' | 'blocked'
  ready_steps: number
  warning_steps: number
  blocking_steps: number
  total_steps: number
  steps: HermesSetupStep[]
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
const HERMES_CRON_ALLOWLIST_FILE = process.env.HERMES_CRON_ALLOWLIST_FILE || path.join(HERMES_HOME, 'cron', 'allowlist.yaml')
const HERMES_OPENCLAW_MONITOR_JOB_ID = 'mission-control-openclaw-heartbeat'
const HERMES_TENANT_AGENT_DIRS: Record<string, string[]> = {
  'ceo-assistant-v1': ['Agent-Main'],
  'media-intel-v1': ['Agent-MediaIntel'],
  'web3-research-v1': ['Agent-Web3Research'],
}

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

function tenantIdForAgentDir(agentDir: string): string | null {
  for (const [tenantId, agentDirs] of Object.entries(HERMES_TENANT_AGENT_DIRS)) {
    if (agentDirs.includes(agentDir)) return tenantId
  }
  return null
}

function agentDirsForTenant(tenant: string): string[] {
  return HERMES_TENANT_AGENT_DIRS[tenant] || [`Agent-${tenant.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`]
}

function cronJobEvidenceText(job: { id: string; prompt: string; schedule: string }) {
  return `${job.id} ${job.prompt} ${job.schedule}`.toLowerCase()
}

function yamlQuote(value: string): string {
  return JSON.stringify(value)
}

function parseCronAllowlist(raw: string): string[] {
  const ids = new Set<string>()
  for (const line of raw.split('\n')) {
    const plainList = line.match(/^\s*-\s*([A-Za-z0-9._:-]+)\s*$/)
    if (plainList) {
      ids.add(plainList[1])
      continue
    }
    const objectList = line.match(/^\s*-\s*id:\s*["']?([A-Za-z0-9._:-]+)["']?\s*$/)
    if (objectList) ids.add(objectList[1])
  }
  return Array.from(ids)
}

function readCronAllowlist(): HermesCronAllowlistSummary {
  try {
    const raw = readFileSync(HERMES_CRON_ALLOWLIST_FILE, 'utf8')
    return {
      path: HERMES_CRON_ALLOWLIST_FILE,
      exists: true,
      job_ids: parseCronAllowlist(raw),
    }
  } catch {
    return {
      path: HERMES_CRON_ALLOWLIST_FILE,
      exists: false,
      job_ids: [],
    }
  }
}

async function writeHermesCronAllowlist(jobs: any[]) {
  const allowedJobs = jobs
    .map(job => ({
      id: safeCronString(job?.id || job?.name),
      name: safeCronString(job?.name || job?.id),
      schedule: safeCronString(job?.schedule || job?.cron || job?.interval),
    }))
    .filter(job => job.id)

  const lines = [
    '# Mission Control managed Hermes cron allowlist.',
    '# Only job IDs listed here are authorized for Hermes cron execution.',
    'version: 1',
    'allowed_jobs:',
    ...allowedJobs.map(job => [
      `  - id: ${yamlQuote(job.id)}`,
      `    name: ${yamlQuote(job.name || job.id)}`,
      `    schedule: ${yamlQuote(job.schedule || '')}`,
    ].join('\n')),
    '',
  ]
  await mkdir(path.dirname(HERMES_CRON_ALLOWLIST_FILE), { recursive: true })
  await writeFile(HERMES_CRON_ALLOWLIST_FILE, `${lines.join('\n')}`, 'utf8')
}

function safeCronString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function assertSafeJobId(id: string): string {
  const normalized = id.trim()
  if (!normalized) throw new Error('Hermes cron job id is required')
  if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new Error('Hermes cron job id may only use letters, numbers, dots, underscores, colons, and dashes')
  }
  return normalized
}

function assertCronSchedule(schedule: string): string {
  const normalized = schedule.trim().replace(/\s+/g, ' ')
  const parts = normalized.split(' ')
  if (parts.length !== 5) throw new Error('Hermes cron schedule must use 5 fields')
  return normalized
}

function assertCronPrompt(prompt: string): string {
  const normalized = prompt.trim()
  if (!normalized) throw new Error('Hermes cron prompt is required')
  return normalized
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
    cron_allowlist_path: HERMES_CRON_ALLOWLIST_FILE,
    cron_allowlist_exists: existsSync(HERMES_CRON_ALLOWLIST_FILE),
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
      name: job.name || job.id,
      schedule: job.schedule,
      enabled: job.enabled,
      prompt: job.prompt,
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
      : `No Hermes cron jobs found under ${HERMES_CRON_JOBS_FILE}`,
    jobs,
  }
}

async function readHermesCronJobsFile(): Promise<{ envelope: any[] | { jobs: any[]; [key: string]: any }; jobs: any[] }> {
  try {
    const raw = await readFile(HERMES_CRON_JOBS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return { envelope: parsed, jobs: parsed }
    if (Array.isArray(parsed?.jobs)) return { envelope: parsed, jobs: parsed.jobs }
    throw new Error('Hermes cron jobs file must be a JSON array or an object with jobs[]')
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      const jobs: any[] = []
      return { envelope: jobs, jobs }
    }
    throw error
  }
}

async function writeHermesCronJobsFile(envelope: any[] | { jobs: any[]; [key: string]: any }, jobs: any[]) {
  const nextEnvelope = Array.isArray(envelope) ? jobs : { ...envelope, jobs }
  await mkdir(path.dirname(HERMES_CRON_JOBS_FILE), { recursive: true })
  await writeFile(HERMES_CRON_JOBS_FILE, `${JSON.stringify(nextEnvelope, null, 2)}\n`, 'utf8')
}

function buildHermesOpenClawMonitorJob(existing: any | null, payload: HermesCronJobPayload = {}) {
  const now = new Date().toISOString()
  const schedule = assertCronSchedule(safeCronString(payload.schedule) || '*/30 * * * *')
  const prompt = assertCronPrompt(
    safeCronString(payload.prompt) ||
      [
        'Check OpenClaw Agent-* working-context heartbeat freshness for Mission Control.',
        `Vault root: ${VAULT_ROOT}.`,
        'Inspect Agent-* directories, report stale or missing working-context.md files, and keep output concise.',
        'Write evidence only through the approved Hermes guard files: Agent-Shared/hermes-log.md and Agent-Shared/hermes-alerts.jsonl.',
        'Do not modify tenant business vault files.',
      ].join(' ')
  )

  return {
    id: HERMES_OPENCLAW_MONITOR_JOB_ID,
    name: 'Mission Control OpenClaw heartbeat monitor',
    schedule,
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : true,
    prompt,
    created_at: existing?.created_at || now,
    updated_at: now,
  }
}

async function registerHermesOpenClawCronJob(payload: HermesCronJobPayload = {}) {
  const { envelope, jobs } = await readHermesCronJobsFile()
  const existing = jobs.find(job => job?.id === HERMES_OPENCLAW_MONITOR_JOB_ID) || null
  const monitorJob = buildHermesOpenClawMonitorJob(existing, payload)

  const nextJobs = [
    ...jobs.filter(job => job?.id !== HERMES_OPENCLAW_MONITOR_JOB_ID),
    monitorJob,
  ]
  await writeHermesCronJobsFile(envelope, nextJobs)
  await writeHermesCronAllowlist(nextJobs)

  return monitorJob
}

async function upsertHermesCronJob(payload: HermesCronJobPayload) {
  const id = assertSafeJobId(safeCronString(payload.id || payload.name))
  const schedule = assertCronSchedule(safeCronString(payload.schedule))
  const prompt = assertCronPrompt(safeCronString(payload.prompt))
  const { envelope, jobs } = await readHermesCronJobsFile()
  const existing = jobs.find(job => job?.id === id)
  const now = new Date().toISOString()
  const nextJob = {
    ...(existing || {}),
    id,
    name: safeCronString(payload.name) || existing?.name || id,
    schedule,
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : existing?.enabled !== false,
    prompt,
    created_at: existing?.created_at || now,
    updated_at: now,
  }
  const nextJobs = [...jobs.filter(job => job?.id !== id), nextJob]
  await writeHermesCronJobsFile(envelope, nextJobs)
  await writeHermesCronAllowlist(nextJobs)
  return nextJob
}

async function toggleHermesCronJob(payload: HermesCronJobPayload) {
  const id = assertSafeJobId(safeCronString(payload.id || payload.name))
  if (typeof payload.enabled !== 'boolean') throw new Error('Hermes cron enabled must be a boolean')
  const { envelope, jobs } = await readHermesCronJobsFile()
  let found = false
  const now = new Date().toISOString()
  const nextJobs = jobs.map(job => {
    if (job?.id !== id) return job
    found = true
    return { ...job, enabled: payload.enabled, updated_at: now }
  })
  if (!found) throw new Error(`Hermes cron job not found: ${id}`)
  await writeHermesCronJobsFile(envelope, nextJobs)
  await writeHermesCronAllowlist(nextJobs)
}

async function removeHermesCronJob(payload: HermesCronJobPayload) {
  const id = assertSafeJobId(safeCronString(payload.id || payload.name))
  const { envelope, jobs } = await readHermesCronJobsFile()
  const nextJobs = jobs.filter(job => job?.id !== id)
  if (nextJobs.length === jobs.length) throw new Error(`Hermes cron job not found: ${id}`)
  await writeHermesCronJobsFile(envelope, nextJobs)
  await writeHermesCronAllowlist(nextJobs)
}

async function syncHermesCronAllowlist() {
  const { jobs } = await readHermesCronJobsFile()
  await writeHermesCronAllowlist(jobs)
}

function getHermesSetupSummary(input: {
  config: HermesConfigSummary
  cron: ReturnType<typeof getCronEvidence>
  daemonRunning: boolean
  targets: HermesTargetStatus[]
  allowlist: HermesCronAllowlistSummary
}): HermesSetupSummary {
  const hasCronMonitoring = input.cron.openclaw_monitoring && input.cron.heartbeat_monitoring
  const hasAllowlistedJob = input.allowlist.job_ids.length === 0
    ? false
    : input.cron.jobs.length === 0 || input.cron.jobs.some(job => input.allowlist.job_ids.includes(job.id))

  const steps: HermesSetupStep[] = [
    {
      id: 'config-yaml',
      label: 'config.yaml',
      status: input.config.config_exists ? 'ready' : 'missing',
      detail: input.config.config_path,
    },
    {
      id: 'soul-md',
      label: 'SOUL.md',
      status: input.config.soul_exists ? 'ready' : 'missing',
      detail: input.config.soul_path,
    },
    {
      id: 'agents-md',
      label: 'AGENTS.md',
      status: input.config.agents_exists ? 'ready' : 'missing',
      detail: input.config.agents_path,
    },
    {
      id: 'cron-jobs',
      label: 'Cron jobs',
      status: hasCronMonitoring ? 'ready' : input.config.cron_jobs_exists ? 'warning' : 'missing',
      detail: input.cron.evidence,
    },
    {
      id: 'cron-allowlist',
      label: 'Cron allowlist',
      status: input.allowlist.exists && hasAllowlistedJob ? 'ready' : input.allowlist.exists ? 'warning' : 'missing',
      detail: input.allowlist.exists
        ? `${input.allowlist.job_ids.length} authorized job${input.allowlist.job_ids.length === 1 ? '' : 's'}`
        : input.allowlist.path,
    },
  ]

  const readySteps = steps.filter(step => step.status === 'ready').length
  const warningSteps = steps.filter(step => step.status === 'warning').length
  const blockingSteps = steps.filter(step => step.status === 'missing').length

  return {
    ready: blockingSteps === 0 && warningSteps === 0,
    status: blockingSteps > 0 ? 'blocked' : warningSteps > 0 ? 'needs-attention' : 'ready',
    ready_steps: readySteps,
    warning_steps: warningSteps,
    blocking_steps: blockingSteps,
    total_steps: steps.length,
    steps,
  }
}

async function listAgentDirs(): Promise<string[]> {
  const entries = await readdir(VAULT_ROOT, { withFileTypes: true }).catch(() => [])
  return entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('Agent-') && entry.name !== 'Agent-Shared' && entry.name !== 'Agent-TEMPLATE')
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}

function heartbeatSeverity(input: {
  contextExists: boolean
  heartbeatAgeSeconds: number | null
}): { severity: HermesTargetStatus['severity']; reason: string; stale: boolean } {
  if (!input.contextExists || input.heartbeatAgeSeconds === null) {
    return { severity: 'missing', reason: 'working-context.md missing', stale: true }
  }
  if (input.heartbeatAgeSeconds > 24 * 60 * 60) {
    return { severity: 'critical', reason: `${formatDuration(input.heartbeatAgeSeconds)} stale`, stale: true }
  }
  if (input.heartbeatAgeSeconds > 60 * 60) {
    return { severity: 'warning', reason: `${formatDuration(input.heartbeatAgeSeconds)} stale`, stale: true }
  }
  return { severity: 'healthy', reason: `fresh ${formatDuration(input.heartbeatAgeSeconds)} ago`, stale: false }
}

function moreSevere(
  left: HermesTargetStatus['severity'],
  right: HermesTargetStatus['severity'],
): HermesTargetStatus['severity'] {
  const rank: Record<HermesTargetStatus['severity'], number> = {
    healthy: 0,
    warning: 1,
    missing: 2,
    critical: 3,
  }
  return rank[right] > rank[left] ? right : left
}

function runtimeReason(errorText: string, tenant: string): HermesTenantRuntime {
  const detail = errorText.trim() || 'docker inspect failed'
  if (/no such container|not found/i.test(detail)) {
    return {
      tenant,
      status: 'missing',
      severity: 'critical',
      detail: `container not found: ${tenant}`,
    }
  }
  if (/cannot connect|connection refused|network|timeout|timed out/i.test(detail)) {
    return {
      tenant,
      status: 'network-error',
      severity: 'critical',
      detail: `network or Docker daemon unavailable: ${detail}`,
    }
  }
  return {
    tenant,
    status: 'unknown',
    severity: 'critical',
    detail,
  }
}

async function inspectTenantRuntime(tenant: string): Promise<HermesTenantRuntime> {
  const dockerBin = process.env.MC_HARNESS_DOCKER_BIN || 'docker'
  try {
    const result = await runCommand(dockerBin, ['inspect', tenant], { timeoutMs: 5_000 })
    const parsed = JSON.parse(result.stdout) as Array<{ State?: { Running?: boolean; Health?: { Status?: string } } }>
    const state = parsed[0]?.State
    const running = state?.Running === true
    const health = typeof state?.Health?.Status === 'string' ? state.Health.Status : null
    if (!running) {
      return {
        tenant,
        status: 'stopped',
        severity: 'critical',
        detail: `${tenant} container is not running`,
      }
    }
    if (health && health !== 'healthy') {
      return {
        tenant,
        status: 'running',
        severity: health === 'starting' ? 'warning' : 'critical',
        detail: `${tenant} container health is ${health}`,
      }
    }
    return {
      tenant,
      status: 'running',
      severity: 'healthy',
      detail: health ? `${tenant} is running and ${health}` : `${tenant} is running`,
    }
  } catch (error: any) {
    return runtimeReason(error?.stderr || error?.stdout || error?.message || '', tenant)
  }
}

function parseInspectionSummary(logTail: string): HermesInspectionSummary {
  const timestamps: string[] = []
  for (const line of logTail.split('\n')) {
    const heading = line.match(/^##\s+([^\s]+)\s+first heartbeat/)
    if (heading) timestamps.push(heading[1])
    const event = line.match(/^\s*-?\s*([^|]+)\|/)
    if (event) {
      const value = event[1].trim()
      if (!Number.isNaN(new Date(value).getTime())) timestamps.push(value)
    }
  }
  return { last_run_at: timestamps.at(-1) || null }
}

function repairActionType(kind: string, detail: string): HermesRepairHistoryItem['action_type'] | null {
  const normalized = `${kind} ${detail}`.toLowerCase()
  if (normalized.includes('alert') || normalized.includes('告警')) return 'send_alert'
  if (normalized.includes('restart') || normalized.includes('restarted')) return 'restart_container'
  if (normalized.includes('cleanup') || normalized.includes('cleaned') || normalized.includes('stale record')) return 'cleanup_stale'
  return null
}

function repairResult(kind: string, detail: string): HermesRepairHistoryItem['result'] {
  return /fail|failed|error|denied|失败/i.test(`${kind} ${detail}`) ? 'failure' : 'success'
}

function parseLogRepairHistory(logTail: string): HermesRepairHistoryItem[] {
  const items: HermesRepairHistoryItem[] = []
  for (const line of logTail.split('\n')) {
    const match = line.match(/^\s*-?\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*(.+)$/)
    if (!match) continue
    const timestamp = match[1].trim()
    const targetAgent = match[2].trim()
    const kind = match[3].trim()
    const detail = match[4].trim()
    const actionType = repairActionType(kind, detail)
    if (!actionType || Number.isNaN(new Date(timestamp).getTime())) continue
    items.push({
      timestamp,
      action_type: actionType,
      target_agent: targetAgent,
      result: repairResult(kind, detail),
      detail,
      source: 'inspection-log',
    })
  }
  return items
}

async function parseAlertsRepairHistory(): Promise<HermesRepairHistoryItem[]> {
  try {
    const raw = await readFile(ALERTS_FILE, 'utf8')
    return raw.split('\n').flatMap(line => {
      if (!line.trim()) return []
      try {
        const parsed = JSON.parse(line) as { ts?: unknown; agent?: unknown; message?: unknown }
        const timestamp = typeof parsed.ts === 'string' ? parsed.ts : ''
        if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return []
        return [{
          timestamp,
          action_type: 'send_alert' as const,
          target_agent: typeof parsed.agent === 'string' ? parsed.agent : 'Hermes',
          result: 'success' as const,
          detail: typeof parsed.message === 'string' ? parsed.message : 'Hermes alert sent',
          source: 'alerts-jsonl' as const,
        }]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

async function getRepairHistory(logTail: string): Promise<HermesRepairHistoryItem[]> {
  const items = [
    ...parseLogRepairHistory(logTail),
    ...await parseAlertsRepairHistory(),
  ]
  const seen = new Set<string>()
  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .filter(item => {
      const key = `${item.timestamp}|${item.action_type}|${item.target_agent}|${item.detail}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 50)
}

async function getHermesState(options: { tenant?: string | null } = {}) {
  const pid = readPid()
  const daemonRunning = isProcessRunning(pid)
  const logTail = readLogTail()
  const now = Date.now()
  const tenantFilter = options.tenant ? normalizeTenantId(options.tenant) : null
  const allAgentDirs = await listAgentDirs()
  const desiredAgentDirs = tenantFilter ? agentDirsForTenant(tenantFilter) : allAgentDirs
  const agentDirs = tenantFilter
    ? desiredAgentDirs
    : allAgentDirs
  const targets: HermesTargetStatus[] = []
  const config = getHermesConfigSummary()
  const cron = getCronEvidence()
  const allowlist = readCronAllowlist()
  const inspection = parseInspectionSummary(logTail)
  const allRepairHistory = await getRepairHistory(logTail)
  const repairHistory = tenantFilter
    ? allRepairHistory.filter(item => desiredAgentDirs.includes(item.target_agent))
    : allRepairHistory
  const tenantRuntime = tenantFilter ? await inspectTenantRuntime(tenantFilter) : null

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
    const heartbeatDetail = heartbeatSeverity({ contextExists: Boolean(stats), heartbeatAgeSeconds })
    const runtimeDetail = tenantFilter && desiredAgentDirs.includes(agentDir) ? tenantRuntime : null
    const severity = runtimeDetail && runtimeDetail.severity !== 'healthy'
      ? moreSevere(heartbeatDetail.severity, runtimeDetail.severity === 'warning' ? 'warning' : 'critical')
      : heartbeatDetail.severity
    const reasonParts = [heartbeatDetail.reason]
    if (runtimeDetail && runtimeDetail.severity !== 'healthy') reasonParts.push(runtimeDetail.detail)
    targets.push({
      tenant: displayTenant(agentDir),
      tenant_id: tenantFilter || tenantIdForAgentDir(agentDir),
      agent_dir: agentDir,
      health,
      severity,
      reason: reasonParts.join(' · '),
      context_path: contextPath,
      context_exists: Boolean(stats),
      heartbeat_age_seconds: heartbeatAgeSeconds,
      last_heartbeat_at: stats ? stats.mtime.toISOString() : null,
      last_check_at: parsed.lastCheckAt,
      last_alert: parsed.lastAlert,
      container: runtimeDetail,
      stale: heartbeatDetail.stale || Boolean(runtimeDetail && runtimeDetail.severity !== 'healthy'),
    })
  }

  return {
    tenant_filter: tenantFilter,
    daemon_running: daemonRunning,
    pid,
    stale_seconds: STALE_SECONDS,
    vault_root: VAULT_ROOT,
    log_path: LOG_FILE,
    log_tail: logTail,
    config,
    cron,
    allowlist,
    inspection,
    repair_history: repairHistory,
    setup: getHermesSetupSummary({ config, cron, daemonRunning, targets, allowlist }),
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
    const tenant = request.nextUrl.searchParams.get('tenant') || request.nextUrl.searchParams.get('tenant_id')
    return NextResponse.json(await getHermesState({ tenant }), { headers: { 'Cache-Control': 'no-store' } })
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

    if (action === 'register-cron') {
      await registerHermesOpenClawCronJob(body)
    } else if (action === 'save-cron-job') {
      await upsertHermesCronJob(body)
    } else if (action === 'toggle-cron-job') {
      await toggleHermesCronJob(body)
    } else if (action === 'remove-cron-job') {
      await removeHermesCronJob(body)
    } else if (action === 'sync-allowlist') {
      await syncHermesCronAllowlist()
    } else if (action === 'start') {
      await runHermesScript(daemonScript, ['start'])
      await runHermesScript(daemonScript, ['check'])
    } else if (action === 'stop') {
      await runHermesScript(daemonScript, ['stop'])
    } else if (action === 'check') {
      await runHermesScript(daemonScript, ['check'])
    } else if (action === 'heartbeat') {
      const agentDir = typeof body?.agent_dir === 'string' ? body.agent_dir : 'Agent-Hermes'
      await runHermesScript(heartbeatScript, [agentDir, 'manual heartbeat from Mission Control'])
    } else {
      return NextResponse.json({ error: 'action must be register-cron, save-cron-job, toggle-cron-job, remove-cron-job, sync-allowlist, start, stop, check, or heartbeat' }, { status: 400 })
    }

    return NextResponse.json({ success: true, state: await getHermesState() })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Hermes action failed' }, { status: 500 })
  }
}
