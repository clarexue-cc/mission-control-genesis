import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCommand } from '@/lib/command'

export type HermesPanelKey =
  | 'profile'
  | 'boundary'
  | 'skill-curator'
  | 'memory'
  | 'output'
  | 'guardian'
  | 'cron'

export type HermesGuardianModule =
  | 'gateway-health'
  | 'profile-recovery'
  | 'halt-reader'
  | 'token-budget'

export interface HermesPanelConfig {
  key: HermesPanelKey
  stage: string
  title: string
  endpoint: string
  script: string
  summary: string
  actions: string[]
}

export interface HermesCommandInput {
  action?: string
  module?: HermesGuardianModule
  intakePath?: string
  outputPath?: string
  dryRun?: boolean
  sessionsDir?: string
  rulesPath?: string
  skillsDir?: string
  configPath?: string
  backupDir?: string
  memoriesDir?: string
  tenantId?: string
  filePath?: string
  gatewayUrl?: string
  profileDir?: string
  haltSignal?: string
  budgetFile?: string
  usageLog?: string
  tokens?: number | string
  model?: string
  cronDir?: string
  cronName?: string
  status?: string
  durationMs?: number | string
  reason?: string
  timeoutMs?: number
}

export interface HermesCommandSpec {
  command: 'node'
  script: string
  args: string[]
  cwd: string
  timeoutMs: number
}

export interface HermesRunResult {
  success: boolean
  command: string
  stdout: string
  stderr: string
  data: unknown
}

const HERMES_LIB_DIR = path.join('phase0', 'services', 'hermes', 'lib')

const PANEL_CONFIGS: Record<HermesPanelKey, HermesPanelConfig> = {
  profile: {
    key: 'profile',
    stage: 'H-01',
    title: 'Profile Setup',
    endpoint: '/api/harness/hermes/profile-setup',
    script: 'profile-setup.js',
    summary: 'intake -> profile-vars / identity / skills / cron seed',
    actions: ['dry-run', 'generate'],
  },
  boundary: {
    key: 'boundary',
    stage: 'H-02',
    title: 'Boundary Watchdog',
    endpoint: '/api/harness/hermes/boundary',
    script: 'boundary-watchdog.js',
    summary: 'sessions audit against forbidden and drift rules',
    actions: ['scan'],
  },
  'skill-curator': {
    key: 'skill-curator',
    stage: 'H-03',
    title: 'Skill Curator',
    endpoint: '/api/harness/hermes/skill-curator',
    script: 'skill-curator.js',
    summary: 'approved skill audit, snapshot, and restore',
    actions: ['check', 'snapshot', 'restore'],
  },
  memory: {
    key: 'memory',
    stage: 'H-04',
    title: 'Memory Curator',
    endpoint: '/api/harness/hermes/memory',
    script: 'memory-curator.js',
    summary: 'memory audit, curation, and isolation checks',
    actions: ['audit', 'curate', 'check-isolation'],
  },
  output: {
    key: 'output',
    stage: 'H-05',
    title: 'Output Checker',
    endpoint: '/api/harness/hermes/output',
    script: 'output-checker.js',
    summary: 'format, sensitive data, source, and identity checks',
    actions: ['check'],
  },
  guardian: {
    key: 'guardian',
    stage: 'H-06',
    title: 'Guardian V2',
    endpoint: '/api/harness/hermes/guardian',
    script: 'gateway-health.js',
    summary: 'gateway health, profile recovery, halt reader, token budget',
    actions: ['gateway-health', 'profile-recovery', 'halt-reader', 'token-budget'],
  },
  cron: {
    key: 'cron',
    stage: 'H-07',
    title: 'Cron Governance',
    endpoint: '/api/harness/hermes/cron',
    script: 'cron-governance.js',
    summary: 'cron approval, audit, execution logs, and cost checks',
    actions: ['list', 'audit', 'approve', 'revoke', 'log-execution', 'cost-check'],
  },
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function flagFor(action: string): string {
  return `--${action}`
}

export function getHermesPanelConfig(key: HermesPanelKey): HermesPanelConfig {
  return PANEL_CONFIGS[key]
}

export function getHermesHarnessRoot(): string {
  const candidates = [
    process.env.MC_HARNESS_ROOT,
    process.env.GENESIS_HARNESS_ROOT,
    process.env.HERMES_HARNESS_ROOT,
    path.join(os.homedir(), 'Desktop', 'genesis-harness'),
    path.join(os.homedir(), 'genesis-harness'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, HERMES_LIB_DIR))) return candidate
  }

  return candidates[0] || process.cwd()
}

export function getHermesScriptPath(script: string, harnessRoot = getHermesHarnessRoot()): string {
  return path.join(harnessRoot, HERMES_LIB_DIR, script)
}

function buildProfileCommand(input: HermesCommandInput, harnessRoot: string): HermesCommandSpec {
  const script = getHermesScriptPath('profile-setup.js', harnessRoot)
  const action = stringValue(input.action, input.dryRun === false ? 'generate' : 'dry-run')
  const args = [
    script,
    '--intake',
    stringValue(input.intakePath, 'phase0/tenants/tenant-test-001/intake/client-intake-filled.md'),
    '--output',
    stringValue(input.outputPath, 'phase0/tenants/tenant-test-001'),
  ]
  if (action === 'dry-run' || input.dryRun === true) args.push('--dry-run')
  return { command: 'node', script, args, cwd: harnessRoot, timeoutMs: numberValue(input.timeoutMs, 30_000) }
}

function buildBoundaryCommand(input: HermesCommandInput, harnessRoot: string): HermesCommandSpec {
  const script = getHermesScriptPath('boundary-watchdog.js', harnessRoot)
  const args = [
    script,
    '--sessions-dir',
    stringValue(input.sessionsDir, 'phase0/tenants/tenant-test-001/sessions'),
    '--rules',
    stringValue(input.rulesPath, 'phase0/tenants/tenant-test-001/boundary/boundary-rules.json'),
    '--scan',
  ]
  return { command: 'node', script, args, cwd: harnessRoot, timeoutMs: numberValue(input.timeoutMs, 30_000) }
}

function buildSkillCommand(input: HermesCommandInput, harnessRoot: string): HermesCommandSpec {
  const script = getHermesScriptPath('skill-curator.js', harnessRoot)
  const action = stringValue(input.action, 'check')
  const args = [
    script,
    '--skills-dir',
    stringValue(input.skillsDir, 'phase0/tenants/tenant-test-001/skills'),
    '--config',
    stringValue(input.configPath, 'phase0/tenants/tenant-test-001/approved-skills.json'),
    flagFor(action),
  ]
  if (action === 'restore' || action === 'snapshot') {
    args.push('--backup-dir', stringValue(input.backupDir, 'phase0/tenants/tenant-test-001/skills-backup'))
  }
  return { command: 'node', script, args, cwd: harnessRoot, timeoutMs: numberValue(input.timeoutMs, 30_000) }
}

function buildMemoryCommand(input: HermesCommandInput, harnessRoot: string): HermesCommandSpec {
  const script = getHermesScriptPath('memory-curator.js', harnessRoot)
  const action = stringValue(input.action, 'audit')
  const args = [
    script,
    '--memories-dir',
    stringValue(input.memoriesDir, 'phase0/tenants/tenant-test-001/memory/memories'),
    '--config',
    stringValue(input.configPath, 'phase0/tenants/tenant-test-001/memory/memory-config.json'),
    flagFor(action),
  ]
  if (action === 'check-isolation') {
    args.push('--tenant-id', stringValue(input.tenantId, 'tenant-test-001'))
  }
  return { command: 'node', script, args, cwd: harnessRoot, timeoutMs: numberValue(input.timeoutMs, 30_000) }
}

function buildOutputCommand(input: HermesCommandInput, harnessRoot: string): HermesCommandSpec {
  const script = getHermesScriptPath('output-checker.js', harnessRoot)
  const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : ''
  const args = filePath
    ? [script, '--file', filePath]
    : [script, '--sessions-dir', stringValue(input.sessionsDir, 'phase0/tenants/tenant-test-001/sessions')]
  args.push(
    '--config',
    stringValue(input.configPath, 'phase0/tenants/tenant-test-001/output-checker-config.json'),
    '--check',
  )
  return { command: 'node', script, args, cwd: harnessRoot, timeoutMs: numberValue(input.timeoutMs, 30_000) }
}

function buildGuardianCommand(input: HermesCommandInput, harnessRoot: string): HermesCommandSpec {
  const guardianModule = input.module || 'gateway-health'
  const script = getHermesScriptPath(`${guardianModule}.js`, harnessRoot)
  const action = stringValue(input.action, guardianModule === 'profile-recovery' ? 'diagnose' : 'check')
  let args: string[]

  if (guardianModule === 'gateway-health') {
    args = [script, '--gateway-url', stringValue(input.gatewayUrl, 'http://localhost:3000/health'), '--check']
  } else if (guardianModule === 'profile-recovery') {
    args = [script, '--profile-dir', stringValue(input.profileDir, 'phase0/tenants/tenant-test-001'), '--action', action]
  } else if (guardianModule === 'halt-reader') {
    args = [script, '--halt-signal', stringValue(input.haltSignal, 'phase0/tenants/tenant-test-001/halt-signal.json')]
    args.push(action === 'clear' ? '--clear' : '--check')
  } else {
    args = [
      script,
      '--budget-file',
      stringValue(input.budgetFile, 'phase0/tenants/tenant-test-001/budget.json'),
      '--usage-log',
      stringValue(input.usageLog, 'phase0/tenants/tenant-test-001/logs/token-usage.jsonl'),
      action === 'record' ? '--record' : '--check',
    ]
    if (action === 'record') {
      args.push('--tokens', String(numberValue(input.tokens, 0)))
      args.push('--model', stringValue(input.model, 'claude-sonnet-4-20250514'))
    }
  }

  return { command: 'node', script, args, cwd: harnessRoot, timeoutMs: numberValue(input.timeoutMs, 30_000) }
}

function buildCronCommand(input: HermesCommandInput, harnessRoot: string): HermesCommandSpec {
  const script = getHermesScriptPath('cron-governance.js', harnessRoot)
  const action = stringValue(input.action, 'list')
  const args = [script, '--cron-dir', stringValue(input.cronDir, 'phase0/tenants/tenant-test-001/cron')]

  if (action === 'approve' || action === 'revoke') {
    args.push(flagFor(action), stringValue(input.cronName, 'daily-search'))
    if (action === 'revoke' && input.reason) args.push('--reason', String(input.reason))
  } else if (action === 'log-execution') {
    args.push(
      '--log-execution',
      '--cron-name',
      stringValue(input.cronName, 'daily-search'),
      '--status',
      stringValue(input.status, 'success'),
      '--tokens-used',
      String(numberValue(input.tokens, 0)),
      '--duration-ms',
      String(numberValue(input.durationMs, 0)),
    )
  } else if (action === 'cost-check') {
    args.push('--cost-check', '--budget-file', stringValue(input.budgetFile, 'phase0/tenants/tenant-test-001/budget.json'))
  } else {
    args.push(flagFor(action))
  }

  return { command: 'node', script, args, cwd: harnessRoot, timeoutMs: numberValue(input.timeoutMs, 30_000) }
}

export function buildHermesCommand(key: HermesPanelKey, input: HermesCommandInput = {}): HermesCommandSpec {
  const harnessRoot = getHermesHarnessRoot()
  if (key === 'profile') return buildProfileCommand(input, harnessRoot)
  if (key === 'boundary') return buildBoundaryCommand(input, harnessRoot)
  if (key === 'skill-curator') return buildSkillCommand(input, harnessRoot)
  if (key === 'memory') return buildMemoryCommand(input, harnessRoot)
  if (key === 'output') return buildOutputCommand(input, harnessRoot)
  if (key === 'guardian') return buildGuardianCommand(input, harnessRoot)
  return buildCronCommand(input, harnessRoot)
}

export function parseHermesJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    const firstObject = trimmed.search(/[\[{]/)
    if (firstObject >= 0) {
      try {
        return JSON.parse(trimmed.slice(firstObject))
      } catch {
        return { raw: trimmed }
      }
    }
    return { raw: trimmed }
  }
}

export function getHermesPanelStatus(key: HermesPanelKey) {
  const config = getHermesPanelConfig(key)
  const harnessRoot = getHermesHarnessRoot()
  const primaryScript = getHermesScriptPath(config.script, harnessRoot)
  const guardianScripts = ['gateway-health.js', 'profile-recovery.js', 'halt-reader.js', 'token-budget.js']

  return {
    ...config,
    harnessRoot,
    scriptPath: primaryScript,
    scriptExists: fs.existsSync(primaryScript),
    hermesLibDir: path.join(harnessRoot, HERMES_LIB_DIR),
    guardianScripts: key === 'guardian'
      ? guardianScripts.map(script => ({
          script,
          path: getHermesScriptPath(script, harnessRoot),
          exists: fs.existsSync(getHermesScriptPath(script, harnessRoot)),
        }))
      : undefined,
  }
}

export async function runHermesCommand(key: HermesPanelKey, input: HermesCommandInput = {}): Promise<HermesRunResult> {
  const command = buildHermesCommand(key, input)
  if (!fs.existsSync(command.script)) {
    throw new Error(`Hermes script not found: ${command.script}`)
  }

  const result = await runCommand(command.command, command.args, {
    cwd: command.cwd,
    timeoutMs: command.timeoutMs,
  })

  return {
    success: true,
    command: `${command.command} ${command.args.join(' ')}`,
    stdout: result.stdout,
    stderr: result.stderr,
    data: parseHermesJsonOutput(result.stdout),
  }
}
