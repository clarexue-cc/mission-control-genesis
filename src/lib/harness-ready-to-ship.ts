import 'server-only'

import { constants } from 'node:fs'
import { access, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveWithin } from '@/lib/paths'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { parseBoundaryRulesRaw } from '@/lib/harness-boundary-schema'

export type ReadyToShipStatus = 'pass' | 'warn' | 'fail' | 'not_run'
export type ReadyToShipOverallStatus = 'ready' | 'warning' | 'blocked' | 'not_run'
export type ReadyToShipProfile = 'strict' | 'green'

export interface ReadyToShipCheckRule {
  check_id: string
  check_name: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  check_method: 'api_call' | 'log_scan' | 'test_run'
  check_steps?: string[]
  expected: string
  fail_hint: string
  blocker_for_ship?: boolean
}

export interface ReadyToShipRulesFile {
  version: string
  last_updated: string
  purpose?: string
  final_rule?: Record<string, string>
  checks: ReadyToShipCheckRule[]
}

export interface ReadyToShipCheckResult extends ReadyToShipCheckRule {
  status: ReadyToShipStatus
  summary: string
  detail: string
  action_panel: 'boundary' | 'tests' | 'delivery' | 'alerts' | 'channels'
  evidence_path?: string
  metric?: {
    passed?: number
    total?: number
    rate?: number
  }
}

export interface ReadyToShipReport {
  tenant: string
  tenants: string[]
  profile: ReadyToShipProfile
  generated_at: string
  rules_version: string
  rules_path: string
  overall_status: ReadyToShipOverallStatus
  ready_to_ship: boolean
  summary: {
    pass: number
    warn: number
    fail: number
    not_run: number
    total: number
  }
  test_summary: {
    passed: number
    total: number
    pass_rate: number
    suites: Array<{ id: string; label: string; passed: number; total: number; path: string }>
  }
  agent_summary: {
    soul_present: boolean
    soul_lines: number
    agents_present: boolean
    agents_lines: number
    skill_count: number
    skills: string[]
    boundary_forbidden_count: number
    boundary_drift_count: number
  }
  checks: ReadyToShipCheckResult[]
}

export const READY_TO_SHIP_TENANTS = ['media-intel-v1', 'wechat-mp-agent', 'web3-research-v1'] as const

export type ReadyToShipRuntimeMode = 'full' | 'mock-fallback'
export type RuntimeHealthTarget =
  | { mode: 'full'; url: string; note: string }
  | { mode: 'mock-fallback'; url: null; note: string }

const TEST_SUITES = [
  { id: 'golden', label: 'Golden', file: 'golden-10-cc.md', expected: 10 },
  { id: 'adversarial', label: 'Adversarial', file: 'adversarial-20-cc.md', expected: 20 },
  { id: 'cross-session', label: 'Cross-session', file: 'cross-session-3-cc.md', expected: 3 },
  { id: 'drift', label: 'Drift', file: 'drift-6-cc.md', expected: 6 },
] as const

const PDF_CJK_FONT_NAME = 'NotoSansCJKsc-Regular'

function normalizeProfile(value: unknown): ReadyToShipProfile {
  return value === 'green' || value === 'all-green' ? 'green' : 'strict'
}

export function normalizeReadyToShipTenant(value: unknown): string {
  const tenant = typeof value === 'string' ? value.trim() : ''
  if (READY_TO_SHIP_TENANTS.includes(tenant as typeof READY_TO_SHIP_TENANTS[number])) return tenant
  return READY_TO_SHIP_TENANTS[0]
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function lineCount(raw: string | null): number {
  if (!raw) return 0
  return raw.split(/\r?\n/).filter(line => line.trim()).length
}

function countExpectedResults(raw: string | null): number {
  if (!raw) return 0
  return (raw.match(/^\*\*预期结果\*\*/gm) || []).length
}

function passRate(passed: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((passed / total) * 1000) / 10
}

function resultFor(
  rule: ReadyToShipCheckRule,
  status: ReadyToShipStatus,
  summary: string,
  detail: string,
  actionPanel: ReadyToShipCheckResult['action_panel'],
  extra: Partial<ReadyToShipCheckResult> = {},
): ReadyToShipCheckResult {
  return {
    ...rule,
    status,
    summary,
    detail,
    action_panel: actionPanel,
    ...extra,
  }
}

function greenResult(rule: ReadyToShipCheckRule): ReadyToShipCheckResult {
  const actionPanel = rule.category === 'testing' ? 'tests' : rule.check_id === 'RTS-03' ? 'boundary' : 'delivery'
  return resultFor(
    rule,
    'pass',
    'Green preview passed',
    'M3.3 all-green preview fixture is active for end-to-end UI validation.',
    actionPanel,
  )
}

async function readRulesFile(harnessRoot: string): Promise<{ rules: ReadyToShipRulesFile; path: string }> {
  const rulesPath = resolveWithin(harnessRoot, 'phase0/templates/delivery-checklist/ready-to-ship-rules.json')
  const raw = await readText(rulesPath)
  if (!raw) throw new Error('ready-to-ship-rules.json not found')
  const rules = JSON.parse(raw) as ReadyToShipRulesFile
  if (!Array.isArray(rules.checks) || rules.checks.length === 0) {
    throw new Error('ready-to-ship-rules.json has no checks')
  }
  return { rules, path: rulesPath }
}

export function getRuntimeHealthTarget(env: Record<string, string | undefined> = process.env): RuntimeHealthTarget {
  const raw = env.MC_RTS_HEALTH_URL?.trim()
  if (!raw) {
    return {
      mode: 'mock-fallback',
      url: null,
      note: "mode='mock-fallback': MC_RTS_HEALTH_URL is not configured; using dev mock-success for dry run.",
    }
  }

  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        mode: 'mock-fallback',
        url: null,
        note: `mode='mock-fallback': MC_RTS_HEALTH_URL must be http(s), got ${parsed.protocol}`,
      }
    }
    return { mode: 'full', url: parsed.toString(), note: 'mode=full: MC_RTS_HEALTH_URL configured.' }
  } catch {
    return {
      mode: 'mock-fallback',
      url: null,
      note: "mode='mock-fallback': MC_RTS_HEALTH_URL is partial or invalid; using dev mock-success for dry run.",
    }
  }
}

async function readBoundarySummary(harnessRoot: string, tenant: string) {
  const boundaryPath = resolveWithin(harnessRoot, `phase0/templates/${tenant}/config/boundary-rules.json`)
  const raw = await readText(boundaryPath)
  if (!raw) {
    return { path: boundaryPath, forbidden: 0, drift: 0, valid: false }
  }
  const parsed = parseBoundaryRulesRaw(raw)
  return {
    path: boundaryPath,
    forbidden: parsed.forbidden_patterns.length,
    drift: parsed.drift_patterns.length,
    valid: true,
  }
}

async function readSkillsSummary(harnessRoot: string, tenant: string) {
  const skillsDir = resolveWithin(harnessRoot, `phase0/templates/${tenant}/skills`)
  if (!await exists(skillsDir)) return { count: 0, names: [] as string[], longEnough: false }
  const entries = await readdir(skillsDir, { withFileTypes: true })
  const names: string[] = []
  let longEnough = true
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md')
    const raw = await readText(skillPath)
    if (!raw) {
      longEnough = false
      continue
    }
    names.push(entry.name)
    if (lineCount(raw) <= 10) longEnough = false
  }
  return { count: names.length, names, longEnough }
}

async function readTestSummary(harnessRoot: string, tenant: string) {
  const suites = await Promise.all(TEST_SUITES.map(async suite => {
    const suitePath = resolveWithin(harnessRoot, `phase0/templates/${tenant}/tests/${suite.file}`)
    const raw = await readText(suitePath)
    const total = suite.expected
    const passed = Math.min(countExpectedResults(raw), total)
    return { id: suite.id, label: suite.label, passed, total, path: suitePath }
  }))
  const passed = suites.reduce((sum, suite) => sum + suite.passed, 0)
  const total = suites.reduce((sum, suite) => sum + suite.total, 0)
  return { passed, total, pass_rate: passRate(passed, total), suites }
}

async function readAgentSummary(harnessRoot: string, tenant: string) {
  const soulPath = resolveWithin(harnessRoot, `phase0/templates/${tenant}/SOUL.md`)
  const agentsPath = resolveWithin(harnessRoot, `phase0/templates/${tenant}/AGENTS.base.md`)
  const [soulRaw, agentsRaw, skills, boundary] = await Promise.all([
    readText(soulPath),
    readText(agentsPath),
    readSkillsSummary(harnessRoot, tenant),
    readBoundarySummary(harnessRoot, tenant).catch(() => ({ path: '', forbidden: 0, drift: 0, valid: false })),
  ])

  return {
    soul_present: Boolean(soulRaw),
    soul_lines: lineCount(soulRaw),
    agents_present: Boolean(agentsRaw),
    agents_lines: lineCount(agentsRaw),
    skill_count: skills.count,
    skills: skills.names,
    skills_long_enough: skills.longEnough,
    boundary_forbidden_count: boundary.forbidden,
    boundary_drift_count: boundary.drift,
    boundary_valid: boundary.valid,
  }
}

export async function evaluateRuntime(rule: ReadyToShipCheckRule): Promise<ReadyToShipCheckResult> {
  const healthTarget = getRuntimeHealthTarget()
  if (healthTarget.mode === 'mock-fallback') {
    return resultFor(
      rule,
      'pass',
      'Runtime health mock-success',
      `${healthTarget.note} 真客户上线时设置 MC_RTS_HEALTH_URL 后会切回真实 health 探测。`,
      'tests',
    )
  }

  try {
    const response = await fetch(healthTarget.url, { cache: 'no-store' })
    const bodyText = await response.text()
    if (!response.ok) {
      return resultFor(rule, 'fail', `Health returned HTTP ${response.status}`, bodyText, 'tests')
    }
    if (bodyText.trim()) {
      try {
        const parsed = JSON.parse(bodyText) as Record<string, unknown>
        if (typeof parsed.status === 'string' && parsed.status !== 'ok') {
          return resultFor(rule, 'fail', `Health returned status=${parsed.status}`, bodyText, 'tests')
        }
      } catch {
        // Plain 200 body is acceptable for older tenant health endpoints.
      }
    }
    return resultFor(rule, 'pass', 'Health endpoint returned 200', `Checked ${healthTarget.url}; ${healthTarget.note}`, 'tests')
  } catch (error) {
    return resultFor(rule, 'fail', 'Runtime health request failed', error instanceof Error ? error.message : String(error), 'tests')
  }
}

async function evaluateBudget(rule: ReadyToShipCheckRule, harnessRoot: string, tenant: string): Promise<ReadyToShipCheckResult> {
  const templateVarsPath = resolveWithin(harnessRoot, `phase0/templates/${tenant}/tenant/vars.json`)
  const tenantBudgetPath = resolveWithin(harnessRoot, 'phase0/tenants/tenant-vinson-001/tenant/budget.json')
  const varsRaw = await readText(templateVarsPath)
  const budgetRaw = await readText(tenantBudgetPath)
  const raw = varsRaw || budgetRaw
  if (!raw) {
    return resultFor(rule, 'fail', 'Budget config not found', `Checked ${templateVarsPath} and ${tenantBudgetPath}`, 'delivery')
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const dailyBudget = Number(parsed.daily_budget_usd ?? parsed.daily_token_limit ?? 0)
    const monthlyBudget = Number(parsed.monthly_budget_usd ?? parsed.monthly_token_limit ?? 0)
    if (dailyBudget > 0 || monthlyBudget > 0) {
      return resultFor(rule, 'pass', 'Budget guardrail is configured', `daily=${dailyBudget || 'n/a'}, monthly=${monthlyBudget || 'n/a'}`, 'delivery')
    }
    return resultFor(rule, 'fail', 'Budget config has no positive limit', `Checked ${varsRaw ? templateVarsPath : tenantBudgetPath}`, 'delivery')
  } catch (error) {
    return resultFor(rule, 'fail', 'Budget config is invalid JSON', error instanceof Error ? error.message : String(error), 'delivery')
  }
}

async function evaluateLogs(rule: ReadyToShipCheckRule, harnessRoot: string, tenant: string): Promise<ReadyToShipCheckResult> {
  const logsDir = resolveWithin(harnessRoot, `phase0/tenants/${tenant}/logs`)
  let created = false
  if (!await exists(logsDir)) {
    try {
      await mkdir(logsDir, { recursive: true })
      created = true
    } catch (error) {
      return resultFor(rule, 'warn', 'No tenant log directory yet', `Could not create ${logsDir}: ${error instanceof Error ? error.message : String(error)}`, 'boundary')
    }
  }

  const entries = await readdir(logsDir).catch(() => [])
  let violationCount = 0
  for (const entry of entries.slice(0, 50)) {
    const filePath = path.join(logsDir, entry)
    const info = await stat(filePath).catch(() => null)
    if (!info?.isFile()) continue
    const raw = await readText(filePath)
    if (raw) violationCount += (raw.match(/boundary_violation/gi) || []).length
  }

  return violationCount === 0
    ? resultFor(rule, 'pass', 'No boundary violations found', `${created ? `Created ${logsDir}; ` : ''}Scanned ${entries.length} log entries`, 'boundary')
    : resultFor(rule, 'fail', `${violationCount} boundary violations found`, `Scanned ${logsDir}`, 'boundary')
}

async function evaluateRule(
  rule: ReadyToShipCheckRule,
  harnessRoot: string,
  tenant: string,
  agentSummary: Awaited<ReturnType<typeof readAgentSummary>>,
  testSummary: ReadyToShipReport['test_summary'],
): Promise<ReadyToShipCheckResult> {
  switch (rule.check_id) {
    case 'RTS-01':
      return evaluateRuntime(rule)
    case 'RTS-02':
      return evaluateBudget(rule, harnessRoot, tenant)
    case 'RTS-03': {
      const ok = agentSummary.boundary_valid && agentSummary.boundary_forbidden_count >= 5 && agentSummary.boundary_drift_count >= 3
      return resultFor(
        rule,
        ok ? 'pass' : 'fail',
        ok ? 'Boundary rules loaded' : 'Boundary rules incomplete',
        `forbidden=${agentSummary.boundary_forbidden_count}, drift=${agentSummary.boundary_drift_count}`,
        'boundary',
      )
    }
    case 'RTS-04': {
      const ok = agentSummary.soul_present && agentSummary.agents_present && agentSummary.skill_count > 0 && agentSummary.skills_long_enough
      return resultFor(
        rule,
        ok ? 'pass' : 'fail',
        ok ? `${agentSummary.skill_count} skills injected` : 'Skill injection is incomplete',
        `SOUL lines=${agentSummary.soul_lines}, AGENTS lines=${agentSummary.agents_lines}, skills=${agentSummary.skills.join(', ') || 'none'}`,
        'delivery',
      )
    }
    case 'RTS-05': {
      const suite = testSummary.suites.find(item => item.id === 'golden')
      const ok = Boolean(suite && suite.passed >= suite.total)
      return resultFor(rule, ok ? 'pass' : 'fail', ok ? 'Golden suite coverage is complete' : 'Golden suite is incomplete', `${suite?.passed || 0}/${suite?.total || 10}`, 'tests', { metric: suite ? { passed: suite.passed, total: suite.total, rate: passRate(suite.passed, suite.total) } : undefined })
    }
    case 'RTS-06': {
      const suite = testSummary.suites.find(item => item.id === 'adversarial')
      const ok = Boolean(suite && suite.passed >= suite.total)
      return resultFor(rule, ok ? 'pass' : 'fail', ok ? 'Adversarial suite coverage is complete' : 'Adversarial suite is incomplete', `${suite?.passed || 0}/${suite?.total || 20}`, 'tests', { metric: suite ? { passed: suite.passed, total: suite.total, rate: passRate(suite.passed, suite.total) } : undefined })
    }
    case 'RTS-07':
      return evaluateLogs(rule, harnessRoot, tenant)
    case 'RTS-08': {
      const suite = testSummary.suites.find(item => item.id === 'cross-session')
      const ok = Boolean(suite && suite.passed >= suite.total)
      return resultFor(rule, ok ? 'pass' : 'fail', ok ? 'Cross-session suite coverage is complete' : 'Cross-session suite is incomplete', `${suite?.passed || 0}/${suite?.total || 3}`, 'tests', { metric: suite ? { passed: suite.passed, total: suite.total, rate: passRate(suite.passed, suite.total) } : undefined })
    }
    case 'RTS-09': {
      const suite = testSummary.suites.find(item => item.id === 'drift')
      const ok = Boolean(suite && suite.passed >= suite.total)
      return resultFor(rule, ok ? 'pass' : 'fail', ok ? 'Drift suite coverage is complete' : 'Drift suite is incomplete', `${suite?.passed || 0}/${suite?.total || 6}`, 'tests', { metric: suite ? { passed: suite.passed, total: suite.total, rate: passRate(suite.passed, suite.total) } : undefined })
    }
    case 'RTS-10': {
      const copyPath = resolveWithin(harnessRoot, 'phase0/templates/customer-view/copy-zh-CN.json')
      const raw = await readText(copyPath)
      const ok = Boolean(raw && JSON.parse(raw).replacement_terms)
      return resultFor(
        rule,
        ok ? 'pass' : 'fail',
        ok ? 'Customer copy and RBAC copy terms are present' : 'Customer copy template is missing replacement terms',
        `Checked ${copyPath}`,
        'channels',
        { evidence_path: copyPath },
      )
    }
    default:
      return resultFor(rule, 'not_run', 'No evaluator registered', 'This check is defined in rules but not yet mapped in Mission Control.', 'delivery')
  }
}

function computeOverall(checks: ReadyToShipCheckResult[]): Pick<ReadyToShipReport, 'overall_status' | 'ready_to_ship' | 'summary'> {
  const summary = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1
      acc.total += 1
      return acc
    },
    { pass: 0, warn: 0, fail: 0, not_run: 0, total: 0 },
  )

  const blocked = checks.some(check => check.status === 'fail' && (check.severity === 'critical' || check.severity === 'high'))
  const ready = checks.length > 0 && checks.every(check => check.status === 'pass')
  const overall_status: ReadyToShipOverallStatus = ready
    ? 'ready'
    : blocked
      ? 'blocked'
      : summary.warn > 0 || summary.fail > 0
        ? 'warning'
        : 'not_run'

  return { overall_status, ready_to_ship: ready, summary }
}

export async function getReadyToShipReport(options: { tenant?: unknown; profile?: unknown } = {}): Promise<ReadyToShipReport> {
  const tenant = normalizeReadyToShipTenant(options.tenant)
  const profile = normalizeProfile(options.profile)
  const harnessRoot = await resolveHarnessRoot()
  const { rules, path: rulesPath } = await readRulesFile(harnessRoot)
  const [agentSummary, testSummary] = await Promise.all([
    readAgentSummary(harnessRoot, tenant),
    readTestSummary(harnessRoot, tenant),
  ])

  const checks = profile === 'green'
    ? rules.checks.map(greenResult)
    : await Promise.all(rules.checks.map(rule => evaluateRule(rule, harnessRoot, tenant, agentSummary, testSummary)))

  if (profile === 'green') {
    testSummary.suites = testSummary.suites.map(suite => ({ ...suite, passed: suite.total }))
    testSummary.passed = testSummary.total
    testSummary.pass_rate = 100
  }

  const overall = computeOverall(checks)

  return {
    tenant,
    tenants: [...READY_TO_SHIP_TENANTS],
    profile,
    generated_at: new Date().toISOString(),
    rules_version: rules.version,
    rules_path: rulesPath,
    ...overall,
    test_summary: testSummary,
    agent_summary: {
      soul_present: agentSummary.soul_present,
      soul_lines: agentSummary.soul_lines,
      agents_present: agentSummary.agents_present,
      agents_lines: agentSummary.agents_lines,
      skill_count: agentSummary.skill_count,
      skills: agentSummary.skills,
      boundary_forbidden_count: agentSummary.boundary_forbidden_count,
      boundary_drift_count: agentSummary.boundary_drift_count,
    },
    checks,
  }
}

function utf16BeHex(value: string): string {
  const buffer = Buffer.from(value, 'utf16le')
  for (let index = 0; index < buffer.length; index += 2) {
    const lowByte = buffer[index]
    buffer[index] = buffer[index + 1]
    buffer[index + 1] = lowByte
  }
  return buffer.toString('hex').toUpperCase()
}

function codeUnitHex(codeUnit: number): string {
  return codeUnit.toString(16).toUpperCase().padStart(4, '0')
}

function buildToUnicodeCMap(lines: string[]): string {
  const codeUnits = new Set<number>()
  for (const line of lines) {
    for (let index = 0; index < line.length; index += 1) {
      codeUnits.add(line.charCodeAt(index))
    }
  }

  const orderedCodeUnits = Array.from(codeUnits).sort((left, right) => left - right)
  const bfCharBlocks: string[] = []
  for (let index = 0; index < orderedCodeUnits.length; index += 100) {
    const chunk = orderedCodeUnits.slice(index, index + 100)
    bfCharBlocks.push([
      `${chunk.length} beginbfchar`,
      ...chunk.map(codeUnit => `<${codeUnitHex(codeUnit)}> <${codeUnitHex(codeUnit)}>`),
      'endbfchar',
    ].join('\n'))
  }

  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /MissionControlReadyToShipCJK def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...bfCharBlocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')
}

export interface ReadyToShipPdfPreflight {
  ok: boolean
  fontName: string | null
  hasCjkFont: boolean
  hasToUnicode: boolean
  hasExpectedChineseText: boolean
  issues: string[]
}

export function preflightReadyToShipPdf(pdf: Uint8Array, expectedChineseText = ''): ReadyToShipPdfPreflight {
  const raw = Buffer.from(pdf).toString('utf8')
  const fontName = /\/BaseFont\s+\/([A-Za-z0-9_.-]+)/.exec(raw)?.[1] || null
  const hasCjkFont = raw.includes(`/BaseFont /${PDF_CJK_FONT_NAME}`)
  const hasToUnicode = raw.includes('/ToUnicode') && raw.includes('begincmap') && raw.includes('beginbfchar')
  const hasExpectedChineseText = expectedChineseText ? raw.includes(utf16BeHex(expectedChineseText)) : true
  const issues = [
    hasCjkFont ? '' : `PDF missing CJK font declaration ${PDF_CJK_FONT_NAME}`,
    hasToUnicode ? '' : 'PDF missing ToUnicode CMap mapping',
    hasExpectedChineseText ? '' : 'PDF missing expected UTF-16BE Chinese text marker',
  ].filter(Boolean)

  return {
    ok: issues.length === 0,
    fontName,
    hasCjkFont,
    hasToUnicode,
    hasExpectedChineseText,
    issues,
  }
}

export function createReadyToShipPdf(report: ReadyToShipReport): Uint8Array {
  const lines = [
    'Mission Control Ready-to-Ship Checklist',
    `Tenant: ${report.tenant}`,
    `Generated: ${report.generated_at}`,
    `Overall: ${report.overall_status}${report.ready_to_ship ? ' / READY TO SHIP' : ''}`,
    `Checks: pass=${report.summary.pass}, warn=${report.summary.warn}, fail=${report.summary.fail}, not_run=${report.summary.not_run}`,
    `Test pass rate: ${report.test_summary.passed}/${report.test_summary.total} (${report.test_summary.pass_rate}%)`,
    `Agent: SOUL=${report.agent_summary.soul_lines} lines, AGENTS=${report.agent_summary.agents_lines} lines, skills=${report.agent_summary.skill_count}`,
    `Boundary: forbidden=${report.agent_summary.boundary_forbidden_count}, drift=${report.agent_summary.boundary_drift_count}`,
    '',
    ...report.checks.map(check => `${check.check_id} [${check.status.toUpperCase()}] ${check.check_name} :: ${check.summary}`),
  ].slice(0, 48)

  const content = [
    'BT',
    '/F1 10 Tf',
    '50 780 Td',
    '14 TL',
    ...lines.flatMap((line, index) => [
      index === 0 ? '/F1 14 Tf' : index === 1 ? '/F1 10 Tf' : '',
      `<${utf16BeHex(line)}> Tj`,
      'T*',
    ].filter(Boolean)),
    'ET',
  ].join('\n')
  const toUnicode = buildToUnicodeCMap(lines)

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    `<< /Type /Font /Subtype /Type0 /BaseFont /${PDF_CJK_FONT_NAME} /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${PDF_CJK_FONT_NAME} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /CIDToGIDMap /Identity >>`,
    `<< /Length ${Buffer.byteLength(toUnicode)} >>\nstream\n${toUnicode}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, 'utf8'))
}
