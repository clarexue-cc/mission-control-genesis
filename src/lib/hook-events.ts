import { constants } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveWithin } from '@/lib/paths'
import { TENANT_ID_RE } from '@/lib/tenant-id'

export const HOOK_EVENT_SOURCE = 'hook-event'
export const HOOK_EVENTS_FILE = 'hook-events.jsonl'
const HOOK_EVENT_RELATIVE_PATHS = [HOOK_EVENTS_FILE, `state/${HOOK_EVENTS_FILE}`]

export interface HookEventLogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: typeof HOOK_EVENT_SOURCE
  session?: string
  message: string
  rule_id?: string
  matched_rule?: string
  matched_rule_id?: string
  severity?: string
  action?: string
  tenant?: string
  details?: string
  data?: Record<string, unknown>
}

export interface HookEventFile {
  path: string
  source: typeof HOOK_EVENT_SOURCE
  tenant: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000 && value < 1_000_000_000_000 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value).getTime()
    if (!Number.isNaN(parsed)) return parsed
  }
  return Date.now()
}

function severityToLevel(severity: string | undefined, action: string | undefined): HookEventLogEntry['level'] {
  const normalized = (severity || '').toLowerCase()
  if (['critical', 'high', 'error'].includes(normalized)) return 'error'
  if (['warn', 'warning', 'medium'].includes(normalized)) return 'warn'
  if (normalized === 'debug') return 'debug'
  return action?.toLowerCase() === 'block' ? 'warn' : 'info'
}

function normalizeTenant(value: string): string {
  if (!TENANT_ID_RE.test(value)) {
    throw new Error('Invalid tenant')
  }
  return value
}

async function canRead(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

export function getHookEventRootCandidates(cwd = process.cwd()): string[] {
  return unique([
    process.env.MC_HARNESS_ROOT,
    process.env.GENESIS_HARNESS_ROOT,
    cwd,
    path.resolve(cwd, '..', 'genesis-harness'),
    path.join(os.homedir(), 'Desktop', 'genesis-harness'),
  ])
}

export async function resolveHookEventRoot(cwd = process.cwd()): Promise<string | null> {
  for (const candidate of getHookEventRootCandidates(cwd)) {
    const tenantsDir = resolveWithin(candidate, 'phase0/tenants')
    if (await canRead(tenantsDir)) return candidate
  }
  return null
}

export async function discoverHookEventFiles(options: { tenant?: string | null } = {}): Promise<HookEventFile[]> {
  const root = await resolveHookEventRoot()
  if (!root) return []

  const tenant = options.tenant?.trim()
  if (tenant) {
    const normalizedTenant = normalizeTenant(tenant)
    const files: HookEventFile[] = []
    for (const relativePath of HOOK_EVENT_RELATIVE_PATHS) {
      const filePath = resolveWithin(root, `phase0/tenants/${normalizedTenant}/${relativePath}`)
      if (await canRead(filePath)) {
        files.push({ path: filePath, source: HOOK_EVENT_SOURCE, tenant: normalizedTenant })
      }
    }
    return files
  }

  const tenantsDir = resolveWithin(root, 'phase0/tenants')
  try {
    const entries = await readdir(tenantsDir, { withFileTypes: true })
    const files: HookEventFile[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !TENANT_ID_RE.test(entry.name)) continue
      for (const relativePath of HOOK_EVENT_RELATIVE_PATHS) {
        const filePath = resolveWithin(root, `phase0/tenants/${entry.name}/${relativePath}`)
        if (await canRead(filePath)) {
          files.push({ path: filePath, source: HOOK_EVENT_SOURCE, tenant: entry.name })
        }
      }
    }
    return files
  } catch {
    return []
  }
}

export function parseHookEventLine(line: string, fileTenant: string, lineNumber = 0): HookEventLogEntry | null {
  if (!line.trim()) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  const event = asRecord(parsed)
  if (!event) return null

  const timestamp = parseTimestamp(event.timestamp)
  const tenant = asText(event.tenant) || fileTenant
  const ruleId =
    asText(event.rule_id) ||
    asText(event.matched_rule_id) ||
    asText(event.rule_matched) ||
    asText(event.matched_rule)
  const matchedRule =
    asText(event.matched_rule) ||
    asText(event.matched_rule_id) ||
    asText(event.rule_matched) ||
    ruleId
  const severity = asText(event.severity)
  const action = asText(event.action)
  const session = asText(event.session_id) || asText(event.session)
  const agent = asText(event.agent)
  const skill = asText(event.skill)
  const preview = asText(event.content_preview) || asText(event.content_full)
  const correlationId = asText(event.correlation_id)
  const level = severityToLevel(severity, action)

  const detailParts = [
    'boundary_violation',
    ruleId ? `rule_id=${ruleId}` : undefined,
    matchedRule ? `matched_rule_id=${matchedRule}` : undefined,
    matchedRule ? `matched_rule=${matchedRule}` : undefined,
    severity ? `severity=${severity}` : undefined,
    action ? `action=${action}` : undefined,
    tenant ? `tenant=${tenant}` : undefined,
    agent ? `agent=${agent}` : undefined,
    skill ? `skill=${skill}` : undefined,
    preview ? `preview=${preview}` : undefined,
  ].filter(Boolean)
  const details = detailParts.join(' ')
  const stableSuffix = correlationId || session || `${fileTenant}:${lineNumber}`

  return {
    id: `${HOOK_EVENT_SOURCE}-${fileTenant}-${timestamp}-${ruleId || 'no-rule'}-${stableSuffix}`,
    timestamp,
    level,
    source: HOOK_EVENT_SOURCE,
    session,
    message: details,
    rule_id: ruleId,
    matched_rule: matchedRule,
    matched_rule_id: matchedRule,
    severity,
    action,
    tenant,
    details,
    data: {
      ...event,
      tenant,
      source_file_tenant: fileTenant,
      event_type: 'boundary_violation',
      rule_id: ruleId,
      matched_rule: matchedRule,
      matched_rule_id: matchedRule,
    },
  }
}

export async function readHookEventFile(file: HookEventFile, maxLines: number): Promise<HookEventLogEntry[]> {
  try {
    const content = await readFile(file.path, 'utf-8')
    const lines = content.split('\n').slice(-maxLines)
    const entries: HookEventLogEntry[] = []
    lines.forEach((line, index) => {
      const entry = parseHookEventLine(line, file.tenant, index)
      if (entry) entries.push(entry)
    })
    return entries
  } catch {
    return []
  }
}
