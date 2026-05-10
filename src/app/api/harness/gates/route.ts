import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import os from 'node:os'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { requireRole } from '@/lib/auth'
import { customerBaseIncludes, parseCustomerBase, type CustomerBase, type CustomerBaseScope } from '@/lib/onboarding-base'

export const dynamic = 'force-dynamic'

type GateStatus = 'pass' | 'warn' | 'fail' | 'pending'

interface GateCheck {
  id: string
  label: string
  base: CustomerBaseScope
  status: GateStatus
  severity: 'critical' | 'high' | 'medium'
  evidence_path: string | null
  detail: string
  next_action: string
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
    if (await exists(candidate)) return candidate
  }
  return null
}

async function listTenants(phase0Dir: string): Promise<string[]> {
  const tenantsDir = path.join(phase0Dir, 'tenants')
  const entries = await readdir(tenantsDir, { withFileTypes: true }).catch(() => [])
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

async function readTemplateId(tenantDir: string): Promise<string | null> {
  const vars = await readJson(path.join(tenantDir, 'tenant', 'vars.json'))
  const candidate = vars?.template_id || vars?.template || vars?.scenario_id
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

function relativeOrNull(phase0Dir: string, filePath: string | null): string | null {
  return filePath ? path.relative(phase0Dir, filePath) : null
}

async function readBoundaryCounts(boundaryPath: string | null) {
  if (!boundaryPath || !boundaryPath.endsWith('.json')) {
    return { forbidden: 0, drift: 0 }
  }
  const rules = await readJson(boundaryPath)
  const forbidden = Array.isArray(rules?.forbidden_patterns) ? rules.forbidden_patterns.length : 0
  const drift = Array.isArray(rules?.drift_patterns) ? rules.drift_patterns.length : 0
  return { forbidden, drift }
}

async function fileSummary(filePath: string | null): Promise<string> {
  if (!filePath) return '未发现证据文件'
  const info = await stat(filePath).catch(() => null)
  if (!info) return '证据文件不可读'
  return `${path.basename(filePath)} · ${(info.size / 1024).toFixed(1)} KB · ${info.mtime.toISOString()}`
}

function summarize(checks: GateCheck[]) {
  const pass = checks.filter(check => check.status === 'pass').length
  const warn = checks.filter(check => check.status === 'warn').length
  const fail = checks.filter(check => check.status === 'fail').length
  const pending = checks.filter(check => check.status === 'pending').length
  const blocking = checks.filter(check => check.status === 'fail' && (check.severity === 'critical' || check.severity === 'high')).length
  return {
    total_checks: checks.length,
    pass,
    warn,
    fail,
    pending,
    blocking,
    status: blocking > 0 ? 'blocked' : pending > 0 || warn > 0 ? 'needs_review' : 'pass',
  }
}

function matchesBase(check: GateCheck, base: CustomerBase): boolean {
  if (check.base === 'shared') return true
  return customerBaseIncludes(base, check.base)
}

function statusFromMetrics(value: unknown, passAtOrBelow: number, warnAtOrBelow: number): GateStatus {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return 'pending'
  if (numeric <= passAtOrBelow) return 'pass'
  if (numeric <= warnAtOrBelow) return 'warn'
  return 'fail'
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const base = parseCustomerBase(request.nextUrl.searchParams.get('base'))
  const phase0Dir = await resolvePhase0Dir()
  if (!phase0Dir) {
    return NextResponse.json({
      phase0_dir: null,
      available: false,
      tenants: [],
      base,
      checks: [],
      summary: summarize([]),
      error: 'phase0 directory not found',
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const tenants = await listTenants(phase0Dir)
  const requestedTenant = request.nextUrl.searchParams.get('tenant') || ''
  const tenantId = tenants.includes(requestedTenant) ? requestedTenant : tenants[0] || ''
  const tenantDir = tenantId ? path.join(phase0Dir, 'tenants', tenantId) : ''
  const templateId = tenantDir ? await readTemplateId(tenantDir) : null
  const templateDirs = [
    templateId ? path.join(phase0Dir, 'templates', templateId, 'tests') : null,
    path.join(phase0Dir, 'templates', tenantId, 'tests'),
    path.join(phase0Dir, 'templates', 'media-intel-v1', 'tests'),
    path.join(phase0Dir, 'templates', 'ceo-assistant-v1', 'tests'),
  ].filter((value): value is string => Boolean(value))
  const tenantTestsDir = tenantDir ? path.join(tenantDir, 'tests') : ''

  const goldenPath = await firstExisting([
    path.join(tenantTestsDir, 'golden-10-cc.md'),
    ...templateDirs.map(dir => path.join(dir, 'golden-10-cc.md')),
  ])
  const adversarialPath = await firstExisting([
    path.join(tenantTestsDir, 'adversarial-20-cc.md'),
    path.join(tenantTestsDir, 'adversarial-25-cc.md'),
    ...templateDirs.flatMap(dir => [path.join(dir, 'adversarial-20-cc.md'), path.join(dir, 'adversarial-25-cc.md')]),
  ])
  const crossSessionPath = await firstExisting([
    path.join(tenantTestsDir, 'cross-session-3-cc.md'),
    path.join(tenantTestsDir, 'cross-session-memory-3-cc.md'),
    ...templateDirs.flatMap(dir => [path.join(dir, 'cross-session-3-cc.md'), path.join(dir, 'cross-session-memory-3-cc.md')]),
  ])
  const driftPath = await firstExisting([
    path.join(tenantTestsDir, 'drift-6-cc.md'),
    path.join(tenantTestsDir, 'drift-8-cc.md'),
    ...templateDirs.flatMap(dir => [path.join(dir, 'drift-6-cc.md'), path.join(dir, 'drift-8-cc.md')]),
  ])
  const boundaryPath = await firstExisting([
    path.join(tenantDir, 'config', 'boundary-rules.json'),
    path.join(tenantDir, 'boundary.yaml'),
    templateId ? path.join(phase0Dir, 'templates', templateId, 'config', 'boundary-rules.json') : '',
    path.join(phase0Dir, 'templates', tenantId, 'config', 'boundary-rules.json'),
  ].filter(Boolean))
  const confirmationPath = await firstExisting([
    path.join(tenantDir, 'vault', 'confirmation-cc.md'),
    path.join(tenantDir, 'confirmation-cc.md'),
  ])
  const boundaryCounts = await readBoundaryCounts(boundaryPath)
  const deployStatus = await readJson(path.join(tenantDir, 'deploy-status.json'))
  const gatewayPath = await firstExisting([
    path.join(tenantDir, 'config', 'gateway.json'),
    path.join(tenantDir, 'gateway.json'),
    path.join(tenantDir, 'deploy-status.json'),
  ])
  const soulPath = await firstExisting([
    path.join(tenantDir, 'vault', 'Agent-Main', 'SOUL.md'),
    path.join(tenantDir, 'SOUL.md'),
  ])
  const metrics = await readJson(path.join(tenantDir, 'state', 'api-metrics.json'))
  const logsPath = await firstExisting([
    path.join(tenantDir, 'logs'),
    path.join(tenantDir, 'hook-events.jsonl'),
    path.join(tenantDir, 'logs', 'events.ndjson'),
  ])
  const haltSignalPath = await firstExisting([
    path.join(tenantDir, 'state', 'halt-signal.json'),
    path.join(tenantDir, 'hermes', 'halt-signal.json'),
    path.join(tenantDir, 'halt-signal.json'),
  ])
  const budgetGatePath = await firstExisting([
    path.join(tenantDir, 'hermes', 'budget-gate.json'),
    path.join(tenantDir, 'state', 'budget-gate.json'),
  ])
  const skillCuratorPath = await firstExisting([
    path.join(tenantDir, 'hermes', 'skill-curator.json'),
    path.join(tenantDir, 'vault', 'Agent-Main', 'skills.json'),
  ])
  const memoryAuditPath = await firstExisting([
    path.join(tenantDir, 'hermes', 'memory-audit.json'),
    path.join(tenantDir, 'vault', 'Agent-Shared', 'memory-audit.json'),
  ])
  const budgetGate = budgetGatePath ? await readJson(budgetGatePath) : null
  const gatewayReady = ['success', 'healthy', 'ok', 'pass'].includes(String(deployStatus?.status || '').toLowerCase()) || Boolean(gatewayPath)
  const budgetLimit = Number(budgetGate?.limit_usd ?? budgetGate?.limit ?? 0)
  const budgetUsed = Number(budgetGate?.used_usd ?? budgetGate?.used ?? 0)
  const budgetOverLimit = Number.isFinite(budgetLimit) && budgetLimit > 0 && Number.isFinite(budgetUsed) && budgetUsed > budgetLimit

  const checks: GateCheck[] = [
    {
      id: 'oc-openclaw-gateway',
      label: 'OpenClaw gateway 连通性',
      base: 'oc',
      status: gatewayReady ? 'pass' : 'fail',
      severity: 'critical',
      evidence_path: relativeOrNull(phase0Dir, gatewayPath),
      detail: deployStatus ? `deploy-status.json status=${String(deployStatus.status || 'unknown')}` : await fileSummary(gatewayPath),
      next_action: gatewayReady ? '保留当前 gateway 连通性证据' : '补齐 gateway 配置或重新执行 P6 deploy',
    },
    {
      id: 'oc-boundary-reload',
      label: 'Boundary reload',
      base: 'oc',
      status: boundaryPath && (boundaryPath.endsWith('.yaml') || (boundaryCounts.forbidden >= 5 && boundaryCounts.drift >= 3)) ? 'pass' : 'fail',
      severity: 'critical',
      evidence_path: relativeOrNull(phase0Dir, boundaryPath),
      detail: boundaryPath?.endsWith('.json')
        ? `forbidden ${boundaryCounts.forbidden} / drift ${boundaryCounts.drift}`
        : await fileSummary(boundaryPath),
      next_action: boundaryPath ? '在 Boundary 面板 reload 并确认规则生效' : '补齐 config/boundary-rules.json',
    },
    {
      id: 'oc-soul-load',
      label: 'soul.md 加载',
      base: 'oc',
      status: soulPath ? 'pass' : 'fail',
      severity: 'critical',
      evidence_path: relativeOrNull(phase0Dir, soulPath),
      detail: await fileSummary(soulPath),
      next_action: soulPath ? '确认 SOUL.md 与当前客户版本一致' : '补齐 vault/Agent-Main/SOUL.md',
    },
    {
      id: 'hermes-halt-reader',
      label: 'halt-reader',
      base: 'hermes',
      status: haltSignalPath ? 'fail' : 'pass',
      severity: 'critical',
      evidence_path: relativeOrNull(phase0Dir, haltSignalPath),
      detail: haltSignalPath ? '发现 halt signal，Hermes 不可上线' : '未发现 halt signal',
      next_action: haltSignalPath ? '处理 halt signal 后重新检查' : '保留 halt-reader 绿灯状态',
    },
    {
      id: 'hermes-budget-gate',
      label: 'budget-gate',
      base: 'hermes',
      status: budgetOverLimit || String(budgetGate?.status || '').toLowerCase() === 'fail' ? 'fail' : budgetGatePath ? 'pass' : 'warn',
      severity: 'critical',
      evidence_path: relativeOrNull(phase0Dir, budgetGatePath),
      detail: budgetGatePath ? `used=${Number.isFinite(budgetUsed) ? budgetUsed : 'unknown'} limit=${Number.isFinite(budgetLimit) ? budgetLimit : 'unknown'}` : 'budget gate evidence missing',
      next_action: budgetGatePath ? '确认 budget-gate 阈值与客户预算一致' : '补齐 hermes/budget-gate.json',
    },
    {
      id: 'hermes-skill-curator',
      label: 'skill-curator',
      base: 'hermes',
      status: skillCuratorPath ? 'pass' : 'warn',
      severity: 'high',
      evidence_path: relativeOrNull(phase0Dir, skillCuratorPath),
      detail: await fileSummary(skillCuratorPath),
      next_action: skillCuratorPath ? '确认技能白名单、pin 和快照已落盘' : '补齐 Hermes skill-curator 证据',
    },
    {
      id: 'hermes-memory-audit',
      label: 'memory-audit',
      base: 'hermes',
      status: memoryAuditPath ? 'pass' : 'warn',
      severity: 'high',
      evidence_path: relativeOrNull(phase0Dir, memoryAuditPath),
      detail: await fileSummary(memoryAuditPath),
      next_action: memoryAuditPath ? '确认 memory audit 无跨 profile 泄漏' : '补齐 Hermes memory-audit 证据',
    },
    {
      id: 'shared-api-latency',
      label: 'API 响应时间',
      base: 'shared',
      status: statusFromMetrics(metrics?.p95_ms ?? metrics?.latency_ms, 1000, 2000),
      severity: 'high',
      evidence_path: relativeOrNull(phase0Dir, metrics ? path.join(tenantDir, 'state', 'api-metrics.json') : null),
      detail: metrics ? `p95=${String(metrics.p95_ms ?? metrics.latency_ms ?? 'unknown')}ms` : 'api metrics missing',
      next_action: metrics ? '确认 P95 响应时间满足上线阈值' : '补齐 state/api-metrics.json',
    },
    {
      id: 'shared-error-rate',
      label: '错误率',
      base: 'shared',
      status: statusFromMetrics(metrics?.error_rate, 0.02, 0.05),
      severity: 'high',
      evidence_path: relativeOrNull(phase0Dir, metrics ? path.join(tenantDir, 'state', 'api-metrics.json') : null),
      detail: metrics ? `error_rate=${String(metrics.error_rate ?? 'unknown')}` : 'api metrics missing',
      next_action: metrics ? '确认错误率低于上线阈值' : '补齐 state/api-metrics.json',
    },
    {
      id: 'shared-log-integrity',
      label: '日志完整性',
      base: 'shared',
      status: logsPath ? 'pass' : 'warn',
      severity: 'medium',
      evidence_path: relativeOrNull(phase0Dir, logsPath),
      detail: await fileSummary(logsPath),
      next_action: logsPath ? '确认日志覆盖闸门、上线准备和交付阶段' : '补齐 logs 目录或 hook-events.jsonl',
    },
    {
      id: 'gate-golden',
      label: 'Golden 测试话术',
      base: 'oc',
      status: goldenPath ? 'pass' : 'fail',
      severity: 'critical',
      evidence_path: relativeOrNull(phase0Dir, goldenPath),
      detail: await fileSummary(goldenPath),
      next_action: goldenPath ? '进入测试控制台逐条运行并记录 pass/fail' : '补齐 tests/golden-10-cc.md',
    },
    {
      id: 'gate-adversarial',
      label: 'Adversarial 对抗测试',
      base: 'oc',
      status: adversarialPath ? 'pass' : 'fail',
      severity: 'critical',
      evidence_path: relativeOrNull(phase0Dir, adversarialPath),
      detail: await fileSummary(adversarialPath),
      next_action: adversarialPath ? '确认 block/warn 级用例失败数不超过阈值' : '补齐 tests/adversarial-20-cc.md',
    },
    {
      id: 'gate-cross-session',
      label: '跨 Session 记忆测试',
      base: 'oc',
      status: crossSessionPath ? 'pass' : 'warn',
      severity: 'high',
      evidence_path: relativeOrNull(phase0Dir, crossSessionPath),
      detail: await fileSummary(crossSessionPath),
      next_action: crossSessionPath ? '运行 3 条跨 session 用例并保存证据' : '补齐 tests/cross-session-3-cc.md',
    },
    {
      id: 'gate-drift',
      label: 'Drift 边界漂移测试',
      base: 'oc',
      status: driftPath ? 'pass' : 'warn',
      severity: 'high',
      evidence_path: relativeOrNull(phase0Dir, driftPath),
      detail: await fileSummary(driftPath),
      next_action: driftPath ? '确认正向误判 0、反向漏判 0' : '补齐 tests/drift-6-cc.md',
    },
    {
      id: 'gate-boundary',
      label: 'Boundary 规则可读',
      base: 'oc',
      status: boundaryPath && (boundaryPath.endsWith('.yaml') || (boundaryCounts.forbidden >= 5 && boundaryCounts.drift >= 3)) ? 'pass' : 'fail',
      severity: 'critical',
      evidence_path: relativeOrNull(phase0Dir, boundaryPath),
      detail: boundaryPath?.endsWith('.json')
        ? `forbidden ${boundaryCounts.forbidden} / drift ${boundaryCounts.drift}`
        : await fileSummary(boundaryPath),
      next_action: boundaryPath ? '在 Boundary 面板加载并确认规则生效' : '补齐 config/boundary-rules.json',
    },
    {
      id: 'gate-approval',
      label: 'Clare 确认单',
      base: 'oc',
      status: confirmationPath ? 'pass' : 'pending',
      severity: 'medium',
      evidence_path: relativeOrNull(phase0Dir, confirmationPath),
      detail: await fileSummary(confirmationPath),
      next_action: confirmationPath ? '确认确认单与当前 tenant 版本一致' : '完成 P5 approval confirmation',
    },
  ]

  const visibleChecks = checks.filter(check => matchesBase(check, base))

  return NextResponse.json({
    phase0_dir: phase0Dir,
    available: true,
    tenants,
    base,
    tenant: {
      tenant_id: tenantId,
      tenant_name: tenantDir ? await readTenantName(tenantDir) : null,
    },
    phase: {
      id: 'P10',
      label: '闸门测试',
      description: '按 OC / Hermes / 共享维度汇总闸门测试证据。',
    },
    summary: summarize(visibleChecks),
    checks: visibleChecks,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
