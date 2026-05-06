import 'server-only'

import type { User } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { normalizeConsoleTenantId } from '@/lib/harness-console-proxy'

type JsonRecord = Record<string, unknown>

export type LangfuseTraceSummary = {
  traceId: string
  timestamp: string | null
  agent: string | null
  skill: string | null
  model: string | null
  latencyMs: number | null
  totalTokens: number | null
  costUsd: number | null
  status: string
}

export type LangfuseAgentStats = {
  agent: string
  totalCalls: number
  successRate: number
  avgLatencyMs: number
  totalCostUsd: number
  topSkills: string[]
}

export type LangfuseTraceDetail = {
  traceId: string
  timestamp: string | null
  agent: string | null
  skill: string | null
  model: string | null
  input: string
  output: string
  latencyMs: number | null
  tokens: number | null
  costUsd: number | null
  langfuseUrl: string
}

type LangfuseConfig = {
  baseUrl: string
  publicKey: string
  secretKey: string
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function roundNumber(value: number, digits = 6): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function getLangfuseConfig(): LangfuseConfig {
  const baseUrl = (process.env.LANGFUSE_BASE_URL || '').trim().replace(/\/+$/, '')
  const publicKey = (process.env.LANGFUSE_PUBLIC_KEY || '').trim()
  const secretKey = (process.env.LANGFUSE_SECRET_KEY || '').trim()

  if (!baseUrl || !publicKey || !secretKey) {
    throw new Error('Langfuse configuration is missing')
  }

  return { baseUrl, publicKey, secretKey }
}

function basicAuthHeader(config: LangfuseConfig): string {
  return `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`
}

export function resolveAuthenticatedTenantSlug(sessionTenantId: unknown): string | null {
  if (typeof sessionTenantId === 'string') {
    try {
      return normalizeConsoleTenantId(sessionTenantId, 'tenantId')
    } catch {
      return null
    }
  }

  if (typeof sessionTenantId !== 'number' || !Number.isInteger(sessionTenantId)) return null

  try {
    const row = getDatabase()
      .prepare('SELECT slug FROM tenants WHERE id = ? LIMIT 1')
      .get(sessionTenantId) as { slug?: unknown } | undefined
    return normalizeConsoleTenantId(row?.slug, 'tenantId')
  } catch {
    return null
  }
}

export function canAccessTenant(user: User, requestedTenantId: string): boolean {
  if (user.role !== 'customer') return true

  const allowedTenantIds = new Set<string>()
  try {
    allowedTenantIds.add(normalizeConsoleTenantId(String(user.tenant_id), 'tenantId'))
  } catch {
    // Numeric tenant ids do not always satisfy the public tenant slug shape.
  }

  const ownedTenantSlug = resolveAuthenticatedTenantSlug(user.tenant_id)
  if (ownedTenantSlug) allowedTenantIds.add(ownedTenantSlug)

  return allowedTenantIds.has(requestedTenantId)
}

export function buildLangfuseTraceSearch(tenantId: string, limit: number, fromTimestamp?: Date): URLSearchParams {
  const search = new URLSearchParams({
    'metadata.tenant': tenantId,
    limit: String(limit),
    orderBy: 'timestamp.desc',
    filter: JSON.stringify([
      {
        type: 'stringObject',
        column: 'metadata',
        key: 'tenant',
        operator: '=',
        value: tenantId,
      },
    ]),
  })

  if (fromTimestamp) search.set('fromTimestamp', fromTimestamp.toISOString())
  return search
}

export async function fetchLangfuseJson(pathname: string, search?: URLSearchParams): Promise<{ ok: true; payload: unknown } | { ok: false; status: number }> {
  const config = getLangfuseConfig()
  const query = search?.toString()
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${pathname}${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: basicAuthHeader(config),
      },
      cache: 'no-store',
    })
  } catch {
    return { ok: false, status: 502 }
  }

  if (!response.ok) return { ok: false, status: response.status }
  return { ok: true, payload: await response.json().catch(() => null) }
}

export function langfuseTraceUrl(traceId: string): string {
  return `${getLangfuseConfig().baseUrl}/trace/${encodeURIComponent(traceId)}`
}

export function unwrapLangfuseTraceList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data
  return []
}

function traceMetadata(trace: unknown): JsonRecord {
  if (!isRecord(trace)) return {}
  if (isRecord(trace.metadata)) return trace.metadata
  if (typeof trace.metadata === 'string') {
    try {
      const parsed = JSON.parse(trace.metadata)
      if (isRecord(parsed)) return parsed
    } catch {
      return {}
    }
  }
  return {}
}

export function traceTenantId(trace: unknown): string | null {
  const metadata = traceMetadata(trace)
  return firstString(metadata.tenant, metadata.tenantId, metadata.tenant_id)
}

function traceObservations(trace: JsonRecord): JsonRecord[] {
  return Array.isArray(trace.observations)
    ? trace.observations.filter(isRecord)
    : []
}

function traceAgent(trace: JsonRecord, metadata: JsonRecord): string | null {
  return firstString(metadata.agent, metadata.agentName, metadata.agent_name, trace.agent, trace.agentName)
}

function traceSkill(trace: JsonRecord, metadata: JsonRecord): string | null {
  return firstString(metadata.skill, metadata.skillName, metadata.skill_name, trace.skill, trace.skillName)
}

function traceModel(trace: JsonRecord, metadata: JsonRecord): string | null {
  const directModel = firstString(metadata.model, trace.model)
  if (directModel) return directModel

  for (const observation of traceObservations(trace)) {
    const model = firstString(observation.model, observation.providedModelName, observation.modelName)
    if (model) return model
  }
  return null
}

function traceLatencyMs(trace: JsonRecord): number | null {
  const latencyMs = finiteNumber(trace.latencyMs ?? trace.latency_ms ?? trace.durationMs)
  if (latencyMs !== null) return Math.round(latencyMs)

  const latencySeconds = finiteNumber(trace.latency ?? trace.duration)
  return latencySeconds === null ? null : Math.round(latencySeconds * 1000)
}

function usageTokenTotal(value: unknown): number | null {
  if (!isRecord(value)) return null
  const direct = finiteNumber(value.total ?? value.totalTokens ?? value.tokens)
  if (direct !== null) return Math.round(direct)

  const input = finiteNumber(value.input ?? value.promptTokens ?? value.inputTokens)
  const output = finiteNumber(value.output ?? value.completionTokens ?? value.outputTokens)
  if (input !== null || output !== null) return Math.round((input || 0) + (output || 0))
  return null
}

function traceTokenTotal(trace: JsonRecord): number | null {
  const direct = finiteNumber(trace.totalTokens ?? trace.tokens ?? trace.tokenCount)
  if (direct !== null) return Math.round(direct)

  const usage = usageTokenTotal(trace.usageDetails ?? trace.usage)
  if (usage !== null) return usage

  let total = 0
  let found = false
  for (const observation of traceObservations(trace)) {
    const observationTokens = usageTokenTotal(observation.usageDetails ?? observation.usage)
    if (observationTokens !== null) {
      total += observationTokens
      found = true
    }
  }
  return found ? Math.round(total) : null
}

function costTotal(value: unknown): number | null {
  if (!isRecord(value)) return null
  return finiteNumber(value.total ?? value.totalCost ?? value.costUsd ?? value.cost)
}

function traceCostUsd(trace: JsonRecord): number | null {
  const direct = finiteNumber(trace.totalCost ?? trace.costUsd ?? trace.cost)
  if (direct !== null) return roundNumber(direct)

  const details = costTotal(trace.costDetails)
  if (details !== null) return roundNumber(details)

  let total = 0
  let found = false
  for (const observation of traceObservations(trace)) {
    const observationCost = costTotal(observation.costDetails ?? observation.cost)
    if (observationCost !== null) {
      total += observationCost
      found = true
    }
  }
  return found ? roundNumber(total) : null
}

function traceStatus(trace: JsonRecord, metadata: JsonRecord): string {
  const explicit = firstString(metadata.status, trace.status)
  if (explicit) return explicit.toLowerCase()

  const errorCount = finiteNumber(trace.errorCount)
  if (errorCount !== null && errorCount > 0) return 'error'

  if (traceObservations(trace).some(observation => firstString(observation.level, observation.status)?.toUpperCase() === 'ERROR')) {
    return 'error'
  }

  return 'success'
}

function stringifyIo(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function customerSafeText(value: unknown, role: User['role']): string {
  const text = stringifyIo(value)
  if (role === 'admin' || text.length <= 200) return text
  return `${text.slice(0, 200)}...`
}

export function mapTraceSummary(trace: unknown): LangfuseTraceSummary {
  const raw = isRecord(trace) ? trace : {}
  const metadata = traceMetadata(raw)
  return {
    traceId: firstString(raw.id, raw.traceId) || '',
    timestamp: firstString(raw.timestamp) || null,
    agent: traceAgent(raw, metadata),
    skill: traceSkill(raw, metadata),
    model: traceModel(raw, metadata),
    latencyMs: traceLatencyMs(raw),
    totalTokens: traceTokenTotal(raw),
    costUsd: traceCostUsd(raw),
    status: traceStatus(raw, metadata),
  }
}

export function mapTraceDetail(trace: unknown, role: User['role']): LangfuseTraceDetail {
  const raw = isRecord(trace) ? trace : {}
  const metadata = traceMetadata(raw)
  const traceId = firstString(raw.id, raw.traceId) || ''
  return {
    traceId,
    timestamp: firstString(raw.timestamp) || null,
    agent: traceAgent(raw, metadata),
    skill: traceSkill(raw, metadata),
    model: traceModel(raw, metadata),
    input: customerSafeText(raw.input, role),
    output: customerSafeText(raw.output, role),
    latencyMs: traceLatencyMs(raw),
    tokens: traceTokenTotal(raw),
    costUsd: traceCostUsd(raw),
    langfuseUrl: langfuseTraceUrl(traceId),
  }
}

export function aggregateAgentStats(traces: unknown[]): LangfuseAgentStats[] {
  const groups = new Map<string, {
    totalCalls: number
    successCalls: number
    latencyTotal: number
    latencyCount: number
    totalCostUsd: number
    skills: Map<string, { count: number; firstSeen: number }>
  }>()
  let skillIndex = 0

  for (const trace of traces) {
    const summary = mapTraceSummary(trace)
    const agent = summary.agent || 'unknown'
    const group = groups.get(agent) || {
      totalCalls: 0,
      successCalls: 0,
      latencyTotal: 0,
      latencyCount: 0,
      totalCostUsd: 0,
      skills: new Map<string, { count: number; firstSeen: number }>(),
    }

    group.totalCalls += 1
    if (summary.status !== 'error') group.successCalls += 1
    if (typeof summary.latencyMs === 'number') {
      group.latencyTotal += summary.latencyMs
      group.latencyCount += 1
    }
    if (typeof summary.costUsd === 'number') group.totalCostUsd += summary.costUsd
    if (summary.skill) {
      const existing = group.skills.get(summary.skill)
      if (existing) {
        existing.count += 1
      } else {
        group.skills.set(summary.skill, { count: 1, firstSeen: skillIndex++ })
      }
    }

    groups.set(agent, group)
  }

  return Array.from(groups.entries())
    .map(([agent, group]) => ({
      agent,
      totalCalls: group.totalCalls,
      successRate: roundNumber((group.successCalls / group.totalCalls) * 100, 2),
      avgLatencyMs: group.latencyCount ? Math.round(group.latencyTotal / group.latencyCount) : 0,
      totalCostUsd: roundNumber(group.totalCostUsd),
      topSkills: Array.from(group.skills.entries())
        .sort(([, left], [, right]) => right.count - left.count || left.firstSeen - right.firstSeen)
        .slice(0, 3)
        .map(([skill]) => skill),
    }))
    .sort((left, right) => right.totalCalls - left.totalCalls || left.agent.localeCompare(right.agent))
}
