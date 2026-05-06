import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { listTenants } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_THRESHOLDS = [80, 95, 100] as const
const AGENT_BUDGETS_DIR =
  process.env.MISSION_CONTROL_AGENT_BUDGETS_PATH ||
  join(config.dataDir, 'mission-control-agent-budgets')
const REQUEST_TIMEOUT_MS = Number(process.env.MC_HARNESS_BUDGET_TIMEOUT_MS || 5000)

type AlertStatus = 'unconfigured' | 'healthy' | 'warning' | 'critical' | 'exceeded'
type AgentBudgetAction = 'pause' | 'warn-only' | 'block-new-only'

interface StoredAgentBudget {
  monthlyBudgetUsd: number
  thresholds: [number, number, number]
  action: AgentBudgetAction
  updatedAt: string
}

interface StoredTenantBudget {
  agents: Record<string, StoredAgentBudget>
}

interface TenantUsageSummary {
  totalCostUsd: number
  totalTokens: number
  requestCount: number
  inputTokens: number
  outputTokens: number
  remainingUsd: number | null
  burnRateDailyUsd: number
  percentUsed: number
}

interface AgentUsageSummary {
  agent: string
  usedUsd: number
  totalTokens: number
  requestCount: number
  inputTokens: number
  outputTokens: number
  lastActiveAt: string | null
  remainingUsd: number | null
  burnRateDailyUsd: number
  percentUsed: number
  budget: {
    monthlyBudgetUsd: number
    thresholds: [number, number, number]
    action: AgentBudgetAction
  }
  alert: {
    status: AlertStatus
    label: string
    threshold: number | null
  }
}

interface TenantBudgetSnapshot {
  tenantId: string
  month: string
  budget: {
    monthlyBudgetUsd: number
    alertAtPercent: number
    actionOnExceed: string
  }
  usage: TenantUsageSummary
  alert: {
    status: AlertStatus
    label: string
    threshold: number | null
  }
  agents: AgentUsageSummary[]
}

class ProxyError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ProxyError'
    this.status = status
  }
}

function roundUsd(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(parsed * 1_000_000) / 1_000_000
}

function toPositiveNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

function normalizeTenantId(value: unknown): string {
  const tenantId = String(value || '').trim()
  if (!tenantId || tenantId === 'current') {
    return 'current'
  }
  if (!/^[a-z0-9-]+$/.test(tenantId)) {
    throw new ProxyError(400, 'tenantId must contain only lowercase letters, numbers, and hyphens')
  }
  return tenantId
}

function resolveCurrentTenantId(user: { tenant_id: number }): string {
  const tenant = listTenants().find((entry) => entry.id === user.tenant_id)
  if (!tenant) {
    throw new ProxyError(404, 'Unknown tenant: current')
  }
  return tenant.slug
}

function normalizeAgentName(value: unknown): string {
  const agent = String(value || '').trim()
  if (!agent) {
    throw new ProxyError(400, 'agent name is required')
  }
  return agent
}

function normalizeThresholds(value: unknown): [number, number, number] {
  const input = Array.isArray(value) ? value : DEFAULT_THRESHOLDS
  const normalized = input
    .slice(0, 3)
    .map((entry, index) => {
      const fallback = DEFAULT_THRESHOLDS[index] ?? DEFAULT_THRESHOLDS[DEFAULT_THRESHOLDS.length - 1]
      const parsed = Number(entry)
      if (!Number.isFinite(parsed) || parsed <= 0) return fallback
      return Math.min(100, Math.round(parsed))
    })

  while (normalized.length < 3) {
    normalized.push(DEFAULT_THRESHOLDS[normalized.length])
  }

  normalized.sort((left, right) => left - right)
  normalized[2] = 100
  return normalized as [number, number, number]
}

function normalizeAgentAction(value: unknown): AgentBudgetAction {
  const normalized = String(value || '').trim()
  if (normalized === 'warn-only' || normalized === 'block-new-only') {
    return normalized
  }
  return 'pause'
}

function dayIndexForMonth(month: string): number {
  const currentMonth = new Date().toISOString().slice(0, 7)
  if (month === currentMonth) return Math.max(1, new Date().getDate())
  return 30
}

function buildAlertStatus(percentUsed: number, thresholds: readonly number[]): {
  status: AlertStatus
  label: string
  threshold: number | null
} {
  if (!Number.isFinite(percentUsed) || percentUsed <= 0) {
    return { status: 'healthy', label: '正常', threshold: thresholds[0] ?? null }
  }
  if (percentUsed >= (thresholds[2] ?? 100)) {
    return { status: 'exceeded', label: '超支', threshold: thresholds[2] ?? 100 }
  }
  if (percentUsed >= (thresholds[1] ?? 95)) {
    return { status: 'critical', label: '临界', threshold: thresholds[1] ?? 95 }
  }
  if (percentUsed >= (thresholds[0] ?? 80)) {
    return { status: 'warning', label: '告警', threshold: thresholds[0] ?? 80 }
  }
  return { status: 'healthy', label: '正常', threshold: thresholds[0] ?? 80 }
}

function controlApiBase(): string {
  const explicit =
    process.env.MC_HARNESS_CONSOLE_API_BASE?.trim() ||
    process.env.GENESIS_HARNESS_CONSOLE_API_BASE?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const host = process.env.MC_HARNESS_CONTROL_API_HOST?.trim() || '127.0.0.1'
  const port = Number(process.env.MC_HARNESS_CONTROL_API_PORT || 3088)
  return `http://${host}:${port}/api/console`
}

async function fetchConsoleJson(endpoint: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const base = controlApiBase()
  const url = `${base}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      cache: 'no-store',
      signal: controller.signal,
    })

    const text = await response.text()
    let payload: any = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    if (!response.ok) {
      throw new ProxyError(
        response.status,
        payload?.error || payload?.message || text || `Harness request failed with ${response.status}`,
      )
    }

    return payload
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new ProxyError(504, 'Harness budget request timed out')
    }
    if (error instanceof ProxyError) {
      throw error
    }
    throw new ProxyError(502, error?.message || 'Failed to reach harness console API')
  } finally {
    clearTimeout(timeout)
  }
}

function tenantBudgetDirPath(tenantId: string): string {
  return join(AGENT_BUDGETS_DIR, tenantId)
}

function agentBudgetFilePath(tenantId: string, agent: string): string {
  const safeName = Buffer.from(agent, 'utf8').toString('base64url')
  return join(tenantBudgetDirPath(tenantId), `${safeName}.json`)
}

function assertTenantAccess(user: { role: string; tenant_id: number }, tenantId: string) {
  const tenant = listTenants().find((entry) => entry.slug === tenantId)
  if (!tenant || (user.role !== 'admin' && tenant.id !== user.tenant_id)) {
    throw new ProxyError(404, `Unknown tenant: ${tenantId}`)
  }
  return tenant
}

async function readTenantBudgetOverlay(tenantId: string): Promise<StoredTenantBudget> {
  try {
    const entries = await readdir(tenantBudgetDirPath(tenantId), { withFileTypes: true })
    const agents: Record<string, StoredAgentBudget> = {}

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const raw = await readFile(join(tenantBudgetDirPath(tenantId), entry.name), 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid budget document')
      const agent = normalizeAgentName((parsed as Record<string, unknown>).agent)
      agents[agent] = normalizeStoredAgentBudget(parsed)
    }

    return { agents }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw new ProxyError(500, 'Agent budget storage is unreadable')
    }
    return {
      agents: {},
    }
  }
}

async function writeAgentBudgetOverlay(tenantId: string, agent: string, budget: StoredAgentBudget) {
  const dirPath = tenantBudgetDirPath(tenantId)
  await mkdir(dirPath, { recursive: true, mode: 0o700 })
  const filePath = agentBudgetFilePath(tenantId, agent)
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(
    tmpPath,
    `${JSON.stringify({
      agent,
      monthlyBudgetUsd: budget.monthlyBudgetUsd,
      thresholds: budget.thresholds,
      action: budget.action,
      updatedAt: budget.updatedAt,
    }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  await rename(tmpPath, filePath)
}

function normalizeStoredAgentBudget(value: unknown): StoredAgentBudget {
  const source = typeof value === 'object' && value ? (value as Record<string, unknown>) : {}
  return {
    monthlyBudgetUsd: roundUsd(source.monthlyBudgetUsd),
    thresholds: normalizeThresholds(source.thresholds),
    action: normalizeAgentAction(source.action),
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : new Date().toISOString(),
  }
}

function normalizeHarnessBudgetPayload(payload: any) {
  const budget = payload?.budget ?? payload ?? {}
  return {
    monthlyBudgetUsd: roundUsd(budget.monthly_budget_usd ?? budget.monthlyBudgetUsd),
    alertAtPercent: Math.max(1, Math.min(100, Math.round(Number(budget.alert_at_percent ?? budget.alertAtPercent ?? DEFAULT_THRESHOLDS[0])) || DEFAULT_THRESHOLDS[0])),
    actionOnExceed: String(budget.action_on_exceed ?? budget.actionOnExceed ?? 'pause'),
  }
}

function normalizeHarnessBillingPayload(payload: any) {
  const totals = payload?.totals ?? {}
  const rawAgents = payload?.byAgent ?? payload?.by_agent ?? []

  return {
    month: String(payload?.month || new Date().toISOString().slice(0, 7)),
    totals: {
      totalCostUsd: roundUsd(totals.estimatedCostUsd ?? totals.estimated_cost_usd),
      totalTokens: Math.round(Number(totals.totalTokens ?? totals.total_tokens ?? 0) || 0),
      requestCount: Math.round(Number(totals.calls ?? totals.requestCount ?? 0) || 0),
      inputTokens: Math.round(Number(totals.inputTokens ?? totals.input_tokens ?? 0) || 0),
      outputTokens: Math.round(Number(totals.outputTokens ?? totals.output_tokens ?? 0) || 0),
    },
    agents: Array.isArray(rawAgents)
      ? rawAgents.map((entry) => ({
          agent: String(entry?.key ?? entry?.agent ?? 'unknown'),
          usedUsd: roundUsd(entry?.estimatedCostUsd ?? entry?.estimated_cost_usd),
          totalTokens: Math.round(Number(entry?.totalTokens ?? entry?.total_tokens ?? 0) || 0),
          requestCount: Math.round(Number(entry?.calls ?? entry?.requestCount ?? 0) || 0),
          inputTokens: Math.round(Number(entry?.inputTokens ?? entry?.input_tokens ?? 0) || 0),
          outputTokens: Math.round(Number(entry?.outputTokens ?? entry?.output_tokens ?? 0) || 0),
          lastActiveAt: entry?.lastCalledAt ?? entry?.last_called_at ?? null,
        }))
      : [],
  }
}

function buildSnapshot(input: {
  tenantId: string
  harnessBudget: any
  harnessBilling: any
  tenantOverlay: StoredTenantBudget
}): TenantBudgetSnapshot {
  const { tenantId, tenantOverlay } = input
  const budget = normalizeHarnessBudgetPayload(input.harnessBudget)
  const billing = normalizeHarnessBillingPayload(input.harnessBilling)
  const tenantThresholds = [budget.alertAtPercent, DEFAULT_THRESHOLDS[1], DEFAULT_THRESHOLDS[2]] as const
  const tenantUsagePercent = budget.monthlyBudgetUsd > 0
    ? roundUsd((billing.totals.totalCostUsd / budget.monthlyBudgetUsd) * 100)
    : 0
  const tenantUsage: TenantUsageSummary = {
    totalCostUsd: billing.totals.totalCostUsd,
    totalTokens: billing.totals.totalTokens,
    requestCount: billing.totals.requestCount,
    inputTokens: billing.totals.inputTokens,
    outputTokens: billing.totals.outputTokens,
    remainingUsd: budget.monthlyBudgetUsd > 0 ? roundUsd(Math.max(budget.monthlyBudgetUsd - billing.totals.totalCostUsd, 0)) : null,
    burnRateDailyUsd: roundUsd(billing.totals.totalCostUsd / dayIndexForMonth(billing.month)),
    percentUsed: tenantUsagePercent,
  }

  const knownAgents = new Set<string>([
    ...billing.agents.map((entry) => entry.agent),
    ...Object.keys(tenantOverlay.agents || {}),
  ])

  const agents: AgentUsageSummary[] = Array.from(knownAgents)
    .map((agent) => {
      const usage = billing.agents.find((entry) => entry.agent === agent) || {
        agent,
        usedUsd: 0,
        totalTokens: 0,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        lastActiveAt: null,
      }
      const stored = normalizeStoredAgentBudget(tenantOverlay.agents?.[agent])
      const percentUsed = stored.monthlyBudgetUsd > 0
        ? roundUsd((usage.usedUsd / stored.monthlyBudgetUsd) * 100)
        : 0
      return {
        agent,
        usedUsd: usage.usedUsd,
        totalTokens: usage.totalTokens,
        requestCount: usage.requestCount,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        lastActiveAt: usage.lastActiveAt,
        remainingUsd: stored.monthlyBudgetUsd > 0 ? roundUsd(Math.max(stored.monthlyBudgetUsd - usage.usedUsd, 0)) : null,
        burnRateDailyUsd: roundUsd(usage.usedUsd / dayIndexForMonth(billing.month)),
        percentUsed,
        budget: {
          monthlyBudgetUsd: stored.monthlyBudgetUsd,
          thresholds: stored.thresholds,
          action: stored.action,
        },
        alert: stored.monthlyBudgetUsd > 0
          ? buildAlertStatus(percentUsed, stored.thresholds)
          : { status: 'unconfigured', label: '未设置', threshold: null },
      }
    })
    .sort((left, right) => right.usedUsd - left.usedUsd || left.agent.localeCompare(right.agent))

  return {
    tenantId,
    month: billing.month,
    budget,
    usage: tenantUsage,
    alert: budget.monthlyBudgetUsd > 0
      ? buildAlertStatus(tenantUsage.percentUsed, tenantThresholds)
      : { status: 'unconfigured', label: '未设置', threshold: null },
    agents,
  }
}

async function loadSnapshot(tenantId: string, tenantOverlay?: StoredTenantBudget): Promise<TenantBudgetSnapshot> {
  const nextOverlay = tenantOverlay || await readTenantBudgetOverlay(tenantId)
  const [harnessBudget, harnessBilling] = await Promise.all([
    fetchConsoleJson(`/budget/${tenantId}`),
    fetchConsoleJson(`/billing/${tenantId}`),
  ])

  return buildSnapshot({
    tenantId,
    harnessBudget,
    harnessBilling,
    tenantOverlay: nextOverlay,
  })
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const requestedTenantId = normalizeTenantId(new URL(request.url).searchParams.get('tenantId'))
    const tenantId = requestedTenantId === 'current' ? resolveCurrentTenantId(auth.user) : requestedTenantId
    assertTenantAccess(auth.user, tenantId)
    const snapshot = await loadSnapshot(tenantId)
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    const status = error instanceof ProxyError ? error.status : 500
    return NextResponse.json({ error: error?.message || 'Failed to load tenant budget' }, { status })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const requestedTenantId = normalizeTenantId(body?.tenantId)
    const tenantId = requestedTenantId === 'current' ? resolveCurrentTenantId(auth.user) : requestedTenantId
    assertTenantAccess(auth.user, tenantId)
    const tenantOverlay = await readTenantBudgetOverlay(tenantId)

    if (body?.tenantBudget && typeof body.tenantBudget === 'object') {
      const tenantBudget = body.tenantBudget as Record<string, unknown>
      await fetchConsoleJson(`/budget/${tenantId}`, {
        method: 'POST',
        body: JSON.stringify({
          monthly_budget_usd: toPositiveNumber(tenantBudget.monthlyBudgetUsd),
          alert_at_percent: Math.max(1, Math.min(100, Math.round(Number(tenantBudget.alertAtPercent) || DEFAULT_THRESHOLDS[0]))),
          action_on_exceed: String(tenantBudget.actionOnExceed || 'pause'),
        }),
      })
    }

    if (body?.agentBudget && typeof body.agentBudget === 'object') {
      const agentBudget = body.agentBudget as Record<string, unknown>
      const agent = normalizeAgentName(agentBudget.agent)
      const nextBudget = {
        monthlyBudgetUsd: toPositiveNumber(agentBudget.monthlyBudgetUsd),
        thresholds: normalizeThresholds(agentBudget.thresholds),
        action: normalizeAgentAction(agentBudget.action),
        updatedAt: new Date().toISOString(),
      }
      tenantOverlay.agents[agent] = nextBudget
      await writeAgentBudgetOverlay(tenantId, agent, nextBudget)
    }

    const snapshot = await loadSnapshot(tenantId, tenantOverlay)
    return NextResponse.json(snapshot)
  } catch (error: any) {
    const status = error instanceof ProxyError ? error.status : 500
    return NextResponse.json({ error: error?.message || 'Failed to save tenant budget' }, { status })
  }
}