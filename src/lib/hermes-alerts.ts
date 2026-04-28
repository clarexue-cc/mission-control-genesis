import 'server-only'

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveWithin } from '@/lib/paths'
import { TENANT_ID_RE } from '@/lib/tenant-id'

export const HERMES_ALERT_SOURCE = 'hermes-alert'

export interface AggregatedAlertEvent {
  id: string
  timestamp: number
  severity: 'critical' | 'high' | 'warning' | 'info'
  title: string
  message: string
  source: 'hermes' | 'system' | 'test'
  source_label: string
  source_type: string
  source_id?: string | number | null
  tenant?: string | null
  agent?: string | null
  acknowledged: boolean
  jump_href: string
  raw?: string
}

export interface HermesAlertFile {
  path: string
  tenant: string | null
  source_label: string
}

function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

async function canRead(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function normalizeTenant(value: string): string {
  if (!TENANT_ID_RE.test(value)) {
    throw new Error('Invalid tenant')
  }
  return value
}

export function getHermesAlertRootCandidates(cwd = process.cwd()): string[] {
  return unique([
    process.env.MC_HARNESS_ROOT,
    process.env.GENESIS_HARNESS_ROOT,
    cwd,
    path.resolve(cwd, '..', 'genesis-harness'),
    path.join(os.homedir(), 'Desktop', 'genesis-harness'),
  ])
}

function getVaultLogCandidates(): string[] {
  const explicit = unique([
    process.env.HERMES_LOG_FILE,
    process.env.MC_OBSIDIAN_VAULT_ROOT ? path.join(process.env.MC_OBSIDIAN_VAULT_ROOT, 'Agent-Shared', 'hermes-log.md') : null,
    process.env.OBSIDIAN_VAULT_ROOT ? path.join(process.env.OBSIDIAN_VAULT_ROOT, 'Agent-Shared', 'hermes-log.md') : null,
  ])
  if (explicit.length > 0) return explicit
  return [path.join(os.homedir(), 'Desktop', 'obsidian', 'openclaw', 'Agent-Shared', 'hermes-log.md')]
}

async function discoverTenantHermesFiles(root: string, tenant?: string | null): Promise<HermesAlertFile[]> {
  const tenantsDir = resolveWithin(root, 'phase0/tenants')
  const files: HermesAlertFile[] = []

  if (tenant) {
    const normalizedTenant = normalizeTenant(tenant)
    for (const relativePath of ['hermes-log.md', 'vault/Agent-Shared/hermes-log.md']) {
      const filePath = resolveWithin(root, `phase0/tenants/${normalizedTenant}/${relativePath}`)
      if (await canRead(filePath)) {
        files.push({ path: filePath, tenant: normalizedTenant, source_label: `Hermes (${normalizedTenant})` })
      }
    }
    return files
  }

  try {
    const entries = await readdir(tenantsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !TENANT_ID_RE.test(entry.name)) continue
      for (const relativePath of ['hermes-log.md', 'vault/Agent-Shared/hermes-log.md']) {
        const filePath = resolveWithin(root, `phase0/tenants/${entry.name}/${relativePath}`)
        if (await canRead(filePath)) {
          files.push({ path: filePath, tenant: entry.name, source_label: `Hermes (${entry.name})` })
        }
      }
    }
  } catch {
    return []
  }

  return files
}

export async function discoverHermesAlertFiles(options: { tenant?: string | null } = {}): Promise<HermesAlertFile[]> {
  const discovered: HermesAlertFile[] = []
  const seen = new Set<string>()

  for (const filePath of getVaultLogCandidates()) {
    if (seen.has(filePath)) continue
    if (await canRead(filePath)) {
      discovered.push({ path: filePath, tenant: null, source_label: 'Hermes vault' })
      seen.add(filePath)
    }
  }

  for (const root of getHermesAlertRootCandidates()) {
    for (const file of await discoverTenantHermesFiles(root, options.tenant)) {
      if (seen.has(file.path)) continue
      discovered.push(file)
      seen.add(file.path)
    }
  }

  return discovered
}

function stableId(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

function severityFromMessage(message: string): AggregatedAlertEvent['severity'] {
  if (/missing|not found|不存在/i.test(message)) return 'critical'
  if (/卡死告警|stale|未更新|超过|heartbeat/i.test(message)) return 'high'
  if (/warn|warning|告警/i.test(message)) return 'warning'
  return 'info'
}

export function parseHermesAlertLine(line: string, file: HermesAlertFile, lineNumber = 0): AggregatedAlertEvent | null {
  if (!line.trim() || !line.includes('| ALERT |')) return null

  const match = line.match(/^\s*-?\s*([^|]+)\|\s*([^|]+)\|\s*ALERT\s*\|\s*(.+)$/)
  if (!match) return null

  const timestampText = match[1].trim()
  const timestamp = new Date(timestampText).getTime()
  if (Number.isNaN(timestamp)) return null

  const agent = match[2].trim()
  const message = match[3].trim()
  const title = message.includes(':') ? message.split(':')[0].trim() : 'Hermes alert'
  const severity = severityFromMessage(message)
  const id = `hermes-${stableId([file.path, String(lineNumber), timestampText, agent, message])}`

  return {
    id,
    timestamp,
    severity,
    title,
    message,
    source: 'hermes',
    source_label: file.source_label,
    source_type: HERMES_ALERT_SOURCE,
    source_id: `${agent}:${timestampText}`,
    tenant: file.tenant,
    agent,
    acknowledged: false,
    jump_href: '/hermes',
    raw: line.trim(),
  }
}

export async function readHermesAlertFile(file: HermesAlertFile, maxLines = 200): Promise<AggregatedAlertEvent[]> {
  try {
    const content = await readFile(file.path, 'utf8')
    const lines = content.split(/\r?\n/).slice(-maxLines)
    const alerts: AggregatedAlertEvent[] = []
    lines.forEach((line, index) => {
      const alert = parseHermesAlertLine(line, file, index)
      if (alert) alerts.push(alert)
    })
    return alerts
  } catch {
    return []
  }
}

export async function getAggregatedHermesAlerts(options: { tenant?: string | null; limit?: number } = {}): Promise<AggregatedAlertEvent[]> {
  const files = await discoverHermesAlertFiles({ tenant: options.tenant })
  const alerts = (await Promise.all(files.map(file => readHermesAlertFile(file)))).flat()
  const deduped = new Map<string, AggregatedAlertEvent>()
  for (const alert of alerts) deduped.set(alert.id, alert)
  return Array.from(deduped.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, options.limit ?? 50)
}
