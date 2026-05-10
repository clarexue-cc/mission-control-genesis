import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { access, appendFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type HookDirection = 'input' | 'output'
type HookAction = 'block' | 'warn' | 'append_disclaimer' | 'pass'
type HookSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

interface HookLogEvent {
  id: string
  timestamp: string
  direction: HookDirection
  tenant: string
  agent: string
  skill: string
  content_preview: string
  content_full: string
  rule_matched: string | null
  action: HookAction
  severity: HookSeverity
  user_id?: string
  session_id?: string
  correlation_id?: string
  latency_ms?: number
  response_template_used?: string | null
  source_file: string
  line_number: number
}

interface TimeWindow {
  label: string
  fromMs: number | null
  toMs: number | null
}

const ACTIONS = new Set(['block', 'warn', 'append_disclaimer', 'pass'])
const DIRECTIONS = new Set(['input', 'output'])
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info'])

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort()
}

async function exists(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function resolvePhase0Dir(): Promise<string | null> {
  const home = os.homedir()
  const candidates = [
    process.env.MC_HARNESS_PHASE0_DIR,
    process.env.GENESIS_HARNESS_PHASE0_DIR,
    '/harness/phase0',
    path.join(home, 'Desktop', 'Claude', 'genesis-harness', 'phase0'),
    path.join(home, 'Desktop', 'genesis-harness', 'phase0'),
    path.join(home, 'genesis-harness', 'phase0'),
    path.resolve(process.cwd(), 'phase0'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  return null
}

function listParam(request: NextRequest, name: string): string[] {
  const values = request.nextUrl.searchParams.getAll(name)
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(value => value.length > 0 && value !== 'all')
  return Array.from(new Set(values))
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(Math.floor(parsed), max)
}

function parseTimeWindow(request: NextRequest): TimeWindow {
  const now = Date.now()
  const range = request.nextUrl.searchParams.get('time_range') || 'last_1h'
  const from = request.nextUrl.searchParams.get('from')
  const to = request.nextUrl.searchParams.get('to')

  if (range === 'custom') {
    const fromMs = from ? Date.parse(from) : null
    const toMs = to ? Date.parse(to) : null
    return {
      label: 'custom',
      fromMs: Number.isFinite(fromMs) ? fromMs : null,
      toMs: Number.isFinite(toMs) ? toMs : null,
    }
  }

  const ranges: Record<string, number | null> = {
    last_1h: 60 * 60 * 1000,
    last_6h: 6 * 60 * 60 * 1000,
    last_24h: 24 * 60 * 60 * 1000,
    last_7d: 7 * 24 * 60 * 60 * 1000,
    all: null,
  }
  const duration = Object.prototype.hasOwnProperty.call(ranges, range) ? ranges[range] : ranges.last_1h
  return {
    label: Object.prototype.hasOwnProperty.call(ranges, range) ? range : 'last_1h',
    fromMs: duration === null ? null : now - duration,
    toMs: null,
  }
}

async function listHookEventFiles(phase0Dir: string) {
  const tenantsDir = path.join(phase0Dir, 'tenants')
  const tenants = await readdir(tenantsDir, { withFileTypes: true }).catch(() => [])
  const files: Array<{ tenantDir: string; filePath: string }> = []

  for (const tenant of tenants) {
    if (!tenant.isDirectory()) continue
    const filePath = path.join(tenantsDir, tenant.name, 'state', 'hook-events.jsonl')
    if (await exists(filePath)) {
      files.push({ tenantDir: tenant.name, filePath })
    }
  }

  return files
}

function normalizeEvent(raw: any, tenantDir: string, filePath: string, lineNumber: number): HookLogEvent | null {
  const timestamp = typeof raw?.timestamp === 'string' ? raw.timestamp : ''
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null

  const direction = DIRECTIONS.has(raw?.direction) ? raw.direction : 'input'
  const action = ACTIONS.has(raw?.action) ? raw.action : 'pass'
  const severity = SEVERITIES.has(raw?.severity) ? raw.severity : 'info'
  const tenant = typeof raw?.tenant === 'string' && raw.tenant.trim() ? raw.tenant.trim() : tenantDir
  const contentPreview = typeof raw?.content_preview === 'string'
    ? raw.content_preview
    : String(raw?.content_full || '').slice(0, 200)
  const contentFull = typeof raw?.content_full === 'string' ? raw.content_full : contentPreview
  const stableKey = `${filePath}:${lineNumber}:${timestamp}:${tenant}:${raw?.correlation_id || ''}:${contentPreview}`

  return {
    id: createHash('sha1').update(stableKey).digest('hex').slice(0, 16),
    timestamp,
    direction,
    tenant,
    agent: typeof raw?.agent === 'string' && raw.agent.trim() ? raw.agent.trim() : 'unknown-agent',
    skill: typeof raw?.skill === 'string' && raw.skill.trim() ? raw.skill.trim() : '__no_skill__',
    content_preview: contentPreview,
    content_full: contentFull,
    rule_matched: typeof raw?.rule_matched === 'string' && raw.rule_matched.trim() ? raw.rule_matched.trim() : null,
    action,
    severity,
    user_id: typeof raw?.user_id === 'string' ? raw.user_id : undefined,
    session_id: typeof raw?.session_id === 'string' ? raw.session_id : undefined,
    correlation_id: typeof raw?.correlation_id === 'string' ? raw.correlation_id : undefined,
    latency_ms: Number.isFinite(raw?.latency_ms) ? Number(raw.latency_ms) : undefined,
    response_template_used: typeof raw?.response_template_used === 'string' ? raw.response_template_used : null,
    source_file: filePath,
    line_number: lineNumber,
  }
}

async function readHookEvents(phase0Dir: string): Promise<HookLogEvent[]> {
  const files = await listHookEventFiles(phase0Dir)
  const events: HookLogEvent[] = []

  for (const file of files) {
    const raw = await readFile(file.filePath, 'utf8').catch(() => '')
    const lines = raw.split(/\r?\n/)
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const event = normalizeEvent(JSON.parse(trimmed), file.tenantDir, file.filePath, index + 1)
        if (event) events.push(event)
      } catch {
        // Skip malformed JSONL rows; the handler should emit valid schema rows, but logs are append-only.
      }
    })
  }

  return events.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
}

function eventInWindow(event: HookLogEvent, window: TimeWindow): boolean {
  const ts = Date.parse(event.timestamp)
  if (window.fromMs !== null && ts < window.fromMs) return false
  if (window.toMs !== null && ts > window.toMs) return false
  return true
}

function filterEvents(events: HookLogEvent[], request: NextRequest, window: TimeWindow): HookLogEvent[] {
  const tenants = listParam(request, 'tenant')
  const agents = listParam(request, 'agent')
  const skills = listParam(request, 'skill')
  const directions = listParam(request, 'direction')
  const actions = listParam(request, 'action')
  const severities = listParam(request, 'severity')
  const rule = (request.nextUrl.searchParams.get('rule') || '').trim().toLowerCase()
  const correlationId = (request.nextUrl.searchParams.get('correlation_id') || '').trim()

  return events.filter(event => {
    if (!eventInWindow(event, window)) return false
    if (tenants.length && !tenants.includes(event.tenant)) return false
    if (agents.length && !agents.includes(event.agent)) return false
    if (skills.length && !skills.includes(event.skill)) return false
    if (directions.length && !directions.includes(event.direction)) return false
    if (actions.length && !actions.includes(event.action)) return false
    if (severities.length && !severities.includes(event.severity)) return false
    if (rule && !(event.rule_matched || '').toLowerCase().startsWith(rule)) return false
    if (correlationId && event.correlation_id !== correlationId) return false
    return true
  })
}

function buildFacets(events: HookLogEvent[]) {
  return {
    tenants: uniq(events.map(event => event.tenant)),
    agents: uniq(events.map(event => event.agent)),
    skills: uniq(events.map(event => event.skill)),
    directions: ['input', 'output'],
    actions: ['block', 'warn', 'append_disclaimer', 'pass'],
    severities: ['critical', 'high', 'medium', 'low', 'info'],
    rules: uniq(events.map(event => event.rule_matched)),
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const phase0Dir = await resolvePhase0Dir()
  if (!phase0Dir) {
    return NextResponse.json({
      events: [],
      pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
      facets: buildFacets([]),
      source: { phase0_dir: null, files: [], available: false },
      filters: { time_range: 'last_1h' },
      error: 'phase0 directory not found',
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const allEvents = await readHookEvents(phase0Dir)
  const files = await listHookEventFiles(phase0Dir)
  const window = parseTimeWindow(request)
  const filtered = filterEvents(allEvents, request, window)
  const page = parsePositiveInt(request.nextUrl.searchParams.get('page'), 1, 10_000)
  const perPage = parsePositiveInt(request.nextUrl.searchParams.get('per_page'), 50, 200)
  const totalPages = Math.ceil(filtered.length / perPage)
  const offset = (page - 1) * perPage
  const paginated = filtered.slice(offset, offset + perPage)

  return NextResponse.json({
    events: paginated,
    pagination: {
      page,
      per_page: perPage,
      total: filtered.length,
      total_pages: totalPages,
    },
    facets: buildFacets(allEvents),
    source: {
      phase0_dir: phase0Dir,
      files: files.map(file => file.filePath),
      available: true,
    },
    filters: {
      tenant: listParam(request, 'tenant'),
      agent: listParam(request, 'agent'),
      skill: listParam(request, 'skill'),
      direction: listParam(request, 'direction'),
      action: listParam(request, 'action'),
      severity: listParam(request, 'severity'),
      time_range: window.label,
      rule: request.nextUrl.searchParams.get('rule') || '',
    },
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const phase0Dir = await resolvePhase0Dir()
  if (!phase0Dir) return NextResponse.json({ error: 'phase0 directory not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  if (body?.action !== 'mark_false_positive' || !body?.event) {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const event = body.event as Partial<HookLogEvent>
  if (event.action === 'pass') {
    return NextResponse.json({ error: 'pass events cannot be marked as false positives' }, { status: 400 })
  }

  const mistakesPath = path.join(phase0Dir, 'templates', 'web3-research-v1', 'tests', 'mistakes.md')
  const entry = [
    `- ${new Date().toISOString()} false_positive`,
    `  - event_id: ${event.id || '-'}`,
    `  - tenant: ${event.tenant || '-'}`,
    `  - agent: ${event.agent || '-'}`,
    `  - rule: ${event.rule_matched || '-'}`,
    `  - action: ${event.action || '-'}`,
    `  - severity: ${event.severity || '-'}`,
    `  - correlation_id: ${event.correlation_id || '-'}`,
    `  - content_preview: ${(event.content_preview || '').replace(/\s+/g, ' ').slice(0, 160)}`,
    '',
  ].join('\n')

  try {
    await mkdir(path.dirname(mistakesPath), { recursive: true })
    await appendFile(mistakesPath, entry, 'utf8')
    return NextResponse.json({ success: true, path: mistakesPath })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to write mistakes.md' }, { status: 500 })
  }
}
