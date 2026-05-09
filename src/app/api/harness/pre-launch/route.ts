import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type ReadinessStatus = 'ready' | 'warning' | 'blocked' | 'pending'
type CheckStatus = 'pass' | 'warn' | 'fail' | 'pending'

interface ShipRule {
  check_id: string
  check_name: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category?: string
  expected?: string
  fail_hint?: string
}

interface PreLaunchCheck {
  id: string
  label: string
  severity: ShipRule['severity']
  category: string
  status: CheckStatus
  expected: string
  evidence: string
  fail_hint: string
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function resolvePhase0Dir(): Promise<string | null> {
  const candidates = [
    process.env.MC_HARNESS_PHASE0_DIR,
    process.env.GENESIS_HARNESS_PHASE0_DIR,
    '/harness/phase0',
    '/Users/clare/Desktop/genesis-harness/phase0',
    path.resolve(process.cwd(), 'phase0'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  return null
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  const raw = await readFile(filePath, 'utf8').catch(() => '')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

async function firstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (candidate && await exists(candidate)) return candidate
  }
  return null
}

async function listTenants(phase0Dir: string): Promise<string[]> {
  const entries = await readdir(path.join(phase0Dir, 'tenants'), { withFileTypes: true }).catch(() => [])
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => !name.startsWith('.'))
    .sort()
}

async function readTenantName(tenantDir: string): Promise<string | null> {
  const vars = await readJson(path.join(tenantDir, 'tenant', 'vars.json'))
  const candidate = vars?.tenant_name || vars?.name || vars?.customer_name
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

async function loadRules(phase0Dir: string) {
  const rulesPath = await firstExisting([
    path.join(phase0Dir, 'templates', 'delivery-checklist', 'ready-to-ship-rules.json'),
    '/Users/clare/Desktop/genesis-harness/phase0/templates/delivery-checklist/ready-to-ship-rules.json',
  ])
  const raw = rulesPath ? await readJson(rulesPath) : null
  const checks = Array.isArray(raw?.checks) ? raw.checks as ShipRule[] : []
  return {
    path: rulesPath,
    version: typeof raw?.version === 'string' ? raw.version : 'unknown',
    final_rule: raw?.final_rule || null,
    checks,
  }
}

async function fileEvidence(filePath: string | null, label: string) {
  if (!filePath) return `${label}: missing`
  const info = await stat(filePath).catch(() => null)
  if (!info) return `${label}: unreadable`
  return `${label}: ${path.basename(filePath)} ${(info.size / 1024).toFixed(1)} KB`
}

function truthyConfig(value: unknown) {
  return value !== undefined && value !== null && value !== '' && value !== 0 && value !== '0' && value !== 'REPLACE_ME'
}

async function evaluateKnownRule(rule: ShipRule, tenantDir: string): Promise<{ status: CheckStatus; evidence: string }> {
  const vars = await readJson(path.join(tenantDir, 'tenant', 'vars.json'))
  const deployStatus = await readJson(path.join(tenantDir, 'deploy-status.json'))
  const boundaryPath = await firstExisting([
    path.join(tenantDir, 'config', 'boundary-rules.json'),
    path.join(tenantDir, 'boundary.yaml'),
  ])
  const soulPath = await firstExisting([
    path.join(tenantDir, 'vault', 'Agent-Main', 'SOUL.md'),
    path.join(tenantDir, 'SOUL.md'),
  ])
  const agentsPath = await firstExisting([
    path.join(tenantDir, 'AGENTS.base.md'),
    path.join(tenantDir, 'vault', 'Agent-Main', 'AGENTS.md'),
  ])
  const goldenPath = await firstExisting([
    path.join(tenantDir, 'tests', 'golden-10-cc.md'),
    path.join(tenantDir, 'vault', 'golden-test-results.md'),
  ])
  const adversarialPath = await firstExisting([
    path.join(tenantDir, 'tests', 'adversarial-20-cc.md'),
    path.join(tenantDir, 'tests', 'adversarial-25-cc.md'),
  ])
  const crossSessionPath = await firstExisting([
    path.join(tenantDir, 'tests', 'cross-session-3-cc.md'),
    path.join(tenantDir, 'tests', 'cross-session-memory-3-cc.md'),
  ])
  const driftPath = await firstExisting([
    path.join(tenantDir, 'tests', 'drift-6-cc.md'),
    path.join(tenantDir, 'tests', 'drift-8-cc.md'),
  ])
  const customerCopyPath = await firstExisting([
    path.join(tenantDir, 'customer-view', 'copy-zh-CN.json'),
    path.join(tenantDir, 'config', 'customer-view.json'),
  ])

  switch (rule.check_id) {
    case 'RTS-01': {
      const ok = deployStatus?.status === 'success' || deployStatus?.status === 'healthy' || deployStatus?.status === 'ok'
      return { status: ok ? 'pass' : 'warn', evidence: deployStatus ? `deploy-status.json status=${String(deployStatus.status || 'unknown')}` : 'deploy-status.json missing' }
    }
    case 'RTS-02': {
      const ok = truthyConfig(vars?.daily_budget_usd) || truthyConfig(vars?.monthly_budget_usd) || truthyConfig(vars?.budget_usd)
      return { status: ok ? 'pass' : 'fail', evidence: ok ? 'budget field configured in tenant/vars.json' : 'budget field missing in tenant/vars.json' }
    }
    case 'RTS-03':
      return { status: boundaryPath ? 'pass' : 'fail', evidence: await fileEvidence(boundaryPath, 'boundary rules') }
    case 'RTS-04':
      return {
        status: soulPath && agentsPath ? 'pass' : 'fail',
        evidence: [await fileEvidence(soulPath, 'SOUL'), await fileEvidence(agentsPath, 'AGENTS')].join(' · '),
      }
    case 'RTS-05':
      return { status: goldenPath ? 'pass' : 'fail', evidence: await fileEvidence(goldenPath, 'golden evidence') }
    case 'RTS-06':
      return { status: adversarialPath ? 'pass' : 'fail', evidence: await fileEvidence(adversarialPath, 'adversarial evidence') }
    case 'RTS-07': {
      const logsDir = path.join(tenantDir, 'logs')
      const hasLogs = await exists(logsDir)
      return { status: hasLogs ? 'pass' : 'warn', evidence: hasLogs ? 'logs directory readable; violation scan ready' : 'logs directory missing; manual scan required' }
    }
    case 'RTS-08':
      return { status: crossSessionPath ? 'pass' : 'warn', evidence: await fileEvidence(crossSessionPath, 'cross-session evidence') }
    case 'RTS-09':
      return { status: driftPath ? 'pass' : 'warn', evidence: await fileEvidence(driftPath, 'drift evidence') }
    case 'RTS-10':
      return {
        status: customerCopyPath || truthyConfig(vars?.customer_role) || truthyConfig(vars?.telegram_bot_token) ? 'pass' : 'warn',
        evidence: customerCopyPath ? await fileEvidence(customerCopyPath, 'customer view') : 'customer view config inferred from tenant vars',
      }
    default:
      return { status: 'pending', evidence: 'No automatic evaluator for this check yet' }
  }
}

function computeReadiness(checks: PreLaunchCheck[]): { status: ReadinessStatus; label: string; blocking: number; warning: number } {
  const blocking = checks.filter(check => check.status === 'fail' && (check.severity === 'critical' || check.severity === 'high')).length
  const warning = checks.filter(check => check.status === 'warn' || check.status === 'pending').length
  if (blocking > 0) return { status: 'blocked', label: 'Blocked', blocking, warning }
  if (warning > 0) return { status: 'warning', label: 'Needs Review', blocking, warning }
  return { status: 'ready', label: 'Ready to Ship', blocking, warning }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const phase0Dir = await resolvePhase0Dir()
  if (!phase0Dir) {
    return NextResponse.json({
      phase0_dir: null,
      available: false,
      tenants: [],
      checks: [],
      readiness: { status: 'pending', label: 'Phase0 Missing', blocking: 0, warning: 0 },
      error: 'phase0 directory not found',
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const tenants = await listTenants(phase0Dir)
  const requestedTenant = request.nextUrl.searchParams.get('tenant') || ''
  const tenantId = tenants.includes(requestedTenant) ? requestedTenant : tenants[0] || ''
  const tenantDir = tenantId ? path.join(phase0Dir, 'tenants', tenantId) : ''
  const rules = await loadRules(phase0Dir)
  const checks = await Promise.all(rules.checks.map(async (rule): Promise<PreLaunchCheck> => {
    const evaluated = tenantDir
      ? await evaluateKnownRule(rule, tenantDir)
      : { status: 'pending' as CheckStatus, evidence: 'No tenant selected' }
    return {
      id: rule.check_id,
      label: rule.check_name,
      severity: rule.severity || 'medium',
      category: rule.category || 'general',
      status: evaluated.status,
      expected: rule.expected || '',
      evidence: evaluated.evidence,
      fail_hint: rule.fail_hint || '',
    }
  }))

  return NextResponse.json({
    phase0_dir: phase0Dir,
    available: true,
    tenants,
    tenant: {
      tenant_id: tenantId,
      tenant_name: tenantDir ? await readTenantName(tenantDir) : null,
    },
    phase: {
      id: 'P12',
      label: '上线准备',
      description: 'Ready-to-Ship 检查清单，确认出货前关键项全绿。',
    },
    rules: {
      path: rules.path,
      version: rules.version,
      final_rule: rules.final_rule,
      total: checks.length,
    },
    readiness: computeReadiness(checks),
    checks,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
