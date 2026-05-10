import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import os from 'node:os'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { requireRole } from '@/lib/auth'
import { customerBaseIncludes, customerBaseLabel, parseCustomerBase, type CustomerBase, type CustomerBaseScope } from '@/lib/onboarding-base'

export const dynamic = 'force-dynamic'

type SectionStatus = 'pass' | 'warn' | 'fail' | 'pending'

interface DeliverySection {
  id: string
  label: string
  base: CustomerBaseScope
  status: SectionStatus
  evidence: Array<{
    label: string
    path: string
    exists: boolean
    bytes: number | null
    updated_at: string | null
  }>
  summary: string
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

async function evidence(phase0Dir: string, label: string, filePath: string | null) {
  if (!filePath) {
    return {
      label,
      path: '',
      exists: false,
      bytes: null,
      updated_at: null,
    }
  }
  const info = await stat(filePath).catch(() => null)
  return {
    label,
    path: path.relative(phase0Dir, filePath),
    exists: Boolean(info),
    bytes: info?.size ?? null,
    updated_at: info?.mtime.toISOString() ?? null,
  }
}

function statusFromEvidence(items: DeliverySection['evidence'], minimum: number, warnWhenPartial = true): SectionStatus {
  const existing = items.filter(item => item.exists).length
  if (existing >= minimum) return 'pass'
  if (existing > 0 && warnWhenPartial) return 'warn'
  return 'pending'
}

function buildReportStatus(sections: DeliverySection[], tenantName: string, base: CustomerBase) {
  const fail = sections.filter(section => section.status === 'fail').length
  const pending = sections.filter(section => section.status === 'pending').length
  const warn = sections.filter(section => section.status === 'warn').length
  const pass = sections.filter(section => section.status === 'pass').length
  const coreReady = ['intake', 'build', 'gates', 'pre_launch', 'uat']
    .every(id => sections.find(section => section.id === id)?.status === 'pass')
  return {
    status: fail > 0 ? 'blocked' : coreReady ? 'ready' : warn > 0 || pending > 0 ? 'needs_review' : 'ready',
    pass,
    warn,
    pending,
    fail,
    total: sections.length,
    summary: `${tenantName} · ${customerBaseLabel(base)} · ${pass}/${sections.length} sections complete`,
  }
}

function matchesBase(section: DeliverySection, base: CustomerBase): boolean {
  if (section.base === 'shared') return true
  return customerBaseIncludes(base, section.base)
}

async function containsUatSignal(filePath: string | null) {
  if (!filePath) return false
  const raw = await readFile(filePath, 'utf8').catch(() => '')
  return /UAT|验收|P21|客户/.test(raw)
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
      sections: [],
      report: { status: 'pending', total: 0, pass: 0, warn: 0, pending: 0, fail: 0, summary: `No phase0 · ${customerBaseLabel(base)} · 0/0 sections complete` },
      error: 'phase0 directory not found',
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const tenants = await listTenants(phase0Dir)
  const requestedTenant = request.nextUrl.searchParams.get('tenant') || ''
  const tenantId = tenants.includes(requestedTenant) ? requestedTenant : tenants[0] || ''
  const tenantDir = tenantId ? path.join(phase0Dir, 'tenants', tenantId) : ''

  const intakeRawPath = await firstExisting([path.join(tenantDir, 'vault', 'intake-raw.md')])
  const intakeAnalysisPath = await firstExisting([path.join(tenantDir, 'vault', 'intake-analysis.md')])
  const confirmationPath = await firstExisting([path.join(tenantDir, 'vault', 'confirmation-cc.md')])
  const varsPath = await firstExisting([path.join(tenantDir, 'tenant', 'vars.json')])
  const soulPath = await firstExisting([path.join(tenantDir, 'vault', 'Agent-Main', 'SOUL.md'), path.join(tenantDir, 'SOUL.md')])
  const agentsPath = await firstExisting([path.join(tenantDir, 'AGENTS.base.md'), path.join(tenantDir, 'vault', 'Agent-Main', 'AGENTS.md')])
  const deployPath = await firstExisting([path.join(tenantDir, 'deploy-status.json')])
  const goldenPath = await firstExisting([path.join(tenantDir, 'tests', 'golden-10-cc.md')])
  const adversarialPath = await firstExisting([path.join(tenantDir, 'tests', 'adversarial-20-cc.md'), path.join(tenantDir, 'tests', 'adversarial-25-cc.md')])
  const crossSessionPath = await firstExisting([path.join(tenantDir, 'tests', 'cross-session-3-cc.md'), path.join(tenantDir, 'tests', 'cross-session-memory-3-cc.md')])
  const checklistPath = await firstExisting([
    path.join(tenantDir, 'ready-to-ship-report.md'),
    path.join(phase0Dir, 'templates', 'delivery-checklist', 'ready-to-ship-rules.json'),
  ])
  const uatPath = await firstExisting([
    path.join(tenantDir, 'vault', 'uat-report.md'),
    path.join(tenantDir, 'uat-submissions.jsonl'),
    path.join(tenantDir, 'uat-tasks.jsonl'),
  ])
  const handoffPath = await firstExisting([
    path.join(tenantDir, 'delivery-report.md'),
    path.join(tenantDir, 'handoff-cc.md'),
    path.join(tenantDir, 'vault', 'delivery-report.md'),
  ])
  const boundaryPath = await firstExisting([
    path.join(tenantDir, 'config', 'boundary-rules.json'),
    path.join(tenantDir, 'boundary.yaml'),
  ])
  const boundaryFinalizedPath = await firstExisting([
    path.join(tenantDir, 'config', 'boundary-finalized.json'),
    path.join(tenantDir, 'config', 'boundary-rules.finalized.json'),
    path.join(tenantDir, 'config', 'boundary-rules.json'),
  ])
  const modulesPath = await firstExisting([
    path.join(tenantDir, 'hermes', 'modules.json'),
    path.join(tenantDir, 'hermes', 'module-status.json'),
  ])
  const budgetGatePath = await firstExisting([
    path.join(tenantDir, 'hermes', 'budget-gate.json'),
    path.join(tenantDir, 'state', 'budget-gate.json'),
  ])
  const haltSignalPath = await firstExisting([
    path.join(tenantDir, 'state', 'halt-signal.json'),
    path.join(tenantDir, 'hermes', 'halt-signal.json'),
    path.join(tenantDir, 'halt-signal.json'),
  ])
  const skillCuratorPath = await firstExisting([
    path.join(tenantDir, 'hermes', 'skill-curator.json'),
    path.join(tenantDir, 'vault', 'Agent-Main', 'skills.json'),
  ])
  const memoryAuditPath = await firstExisting([
    path.join(tenantDir, 'hermes', 'memory-audit.json'),
    path.join(tenantDir, 'vault', 'Agent-Shared', 'memory-audit.json'),
  ])

  const intakeEvidence = [
    await evidence(phase0Dir, '访谈记录', intakeRawPath),
    await evidence(phase0Dir, '分析报告', intakeAnalysisPath),
    await evidence(phase0Dir, '确认单', confirmationPath),
  ]
  const buildEvidence = [
    await evidence(phase0Dir, 'Tenant vars', varsPath),
    await evidence(phase0Dir, 'SOUL.md', soulPath),
    await evidence(phase0Dir, 'AGENTS', agentsPath),
    await evidence(phase0Dir, 'Deploy status', deployPath),
  ]
  const gateEvidence = [
    await evidence(phase0Dir, 'Golden', goldenPath),
    await evidence(phase0Dir, 'Adversarial', adversarialPath),
    await evidence(phase0Dir, 'Cross session', crossSessionPath),
  ]
  const preLaunchEvidence = [
    await evidence(phase0Dir, 'Ready-to-Ship checklist', checklistPath),
  ]
  const uatEvidence = [
    await evidence(phase0Dir, 'UAT report/tasks', uatPath),
    await evidence(phase0Dir, 'UAT standards in analysis', intakeAnalysisPath),
  ]
  const handoffEvidence = [
    await evidence(phase0Dir, 'Delivery report', handoffPath),
    await evidence(phase0Dir, 'Confirmation', confirmationPath),
  ]
  const ocWorkspaceEvidence = [
    await evidence(phase0Dir, 'Tenant vars', varsPath),
    await evidence(phase0Dir, 'Deploy status', deployPath),
    await evidence(phase0Dir, 'AGENTS', agentsPath),
  ]
  const ocBoundaryEvidence = [
    await evidence(phase0Dir, 'Boundary rules', boundaryPath),
    await evidence(phase0Dir, 'Boundary finalized', boundaryFinalizedPath),
  ]
  const ocSoulEvidence = [
    await evidence(phase0Dir, 'SOUL.md', soulPath),
    await evidence(phase0Dir, 'AGENTS', agentsPath),
  ]
  const hermesModuleEvidence = [
    await evidence(phase0Dir, 'Hermes modules', modulesPath),
  ]
  const hermesGuardrailEvidence = [
    await evidence(phase0Dir, 'Budget gate', budgetGatePath),
    {
      label: 'Halt signal clear',
      path: haltSignalPath ? path.relative(phase0Dir, haltSignalPath) : 'state/halt-signal.json',
      exists: !haltSignalPath,
      bytes: null,
      updated_at: null,
    },
    await evidence(phase0Dir, 'Skill curator', skillCuratorPath),
  ]
  const hermesMemoryEvidence = [
    await evidence(phase0Dir, 'Memory audit', memoryAuditPath),
  ]

  const uatSignal = await containsUatSignal(intakeAnalysisPath)
  const sections: DeliverySection[] = [
    {
      id: 'intake',
      label: '需求与确认',
      base: 'shared',
      status: statusFromEvidence(intakeEvidence, 2),
      evidence: intakeEvidence,
      summary: '客户输入、AI 分析与 Clare 确认链路。',
      next_action: '补齐 intake-raw.md / intake-analysis.md / confirmation-cc.md',
    },
    {
      id: 'build',
      label: '构建产物',
      base: 'shared',
      status: statusFromEvidence(buildEvidence, 3),
      evidence: buildEvidence,
      summary: 'Tenant vars、SOUL、AGENTS 与部署状态。',
      next_action: '确认 P6-P9 产物已落盘且版本一致',
    },
    {
      id: 'gates',
      label: '闸门测试',
      base: 'shared',
      status: statusFromEvidence(gateEvidence, 3),
      evidence: gateEvidence,
      summary: 'Golden / Adversarial / 跨 session 交付前测试证据。',
      next_action: '运行闸门测试并保存结果',
    },
    {
      id: 'pre_launch',
      label: '上线准备',
      base: 'shared',
      status: statusFromEvidence(preLaunchEvidence, 1),
      evidence: preLaunchEvidence,
      summary: 'Ready-to-Ship 规则与出货检查清单。',
      next_action: '完成 P12 上线准备检查',
    },
    {
      id: 'uat',
      label: '客户 UAT',
      base: 'shared',
      status: uatPath || uatSignal ? 'pass' : 'warn',
      evidence: uatEvidence,
      summary: '客户验收标准、任务或提交记录。',
      next_action: '把 UAT 草稿推进客户验收任务并记录签收',
    },
    {
      id: 'handoff',
      label: '交付交接',
      base: 'shared',
      status: handoffPath || confirmationPath ? 'pass' : 'pending',
      evidence: handoffEvidence,
      summary: '交付报告、确认单与最终交接材料。',
      next_action: '生成最终 delivery-report 并交付客户可读版本',
    },
    {
      id: 'oc-workspace',
      label: 'OC workspace',
      base: 'oc',
      status: statusFromEvidence(ocWorkspaceEvidence, 2),
      evidence: ocWorkspaceEvidence,
      summary: 'OC tenant workspace、部署状态和运行手册。',
      next_action: '补齐 tenant vars、deploy-status 或 AGENTS',
    },
    {
      id: 'oc-boundary',
      label: 'OC Boundary',
      base: 'oc',
      status: statusFromEvidence(ocBoundaryEvidence, 1),
      evidence: ocBoundaryEvidence,
      summary: 'Boundary 规则和 finalized 标记。',
      next_action: '完成 P8 Boundary finalize',
    },
    {
      id: 'oc-soul-agents',
      label: 'OC SOUL/AGENTS',
      base: 'oc',
      status: statusFromEvidence(ocSoulEvidence, 2),
      evidence: ocSoulEvidence,
      summary: '客户专属 SOUL、AGENTS 和操作标准。',
      next_action: '补齐 SOUL.md 与 AGENTS',
    },
    {
      id: 'hermes-modules',
      label: 'Hermes modules',
      base: 'hermes',
      status: statusFromEvidence(hermesModuleEvidence, 1),
      evidence: hermesModuleEvidence,
      summary: 'H-01 至 H-07 模块状态证据。',
      next_action: '补齐 hermes/modules.json',
    },
    {
      id: 'hermes-guardrails',
      label: 'Hermes guardrails',
      base: 'hermes',
      status: statusFromEvidence(hermesGuardrailEvidence, 2),
      evidence: hermesGuardrailEvidence,
      summary: 'halt-reader、budget-gate 和 skill-curator 交付前守护。',
      next_action: '清理 halt signal 并补齐 budget/skill 证据',
    },
    {
      id: 'hermes-memory',
      label: 'Hermes memory',
      base: 'hermes',
      status: statusFromEvidence(hermesMemoryEvidence, 1),
      evidence: hermesMemoryEvidence,
      summary: 'memory-audit 和跨 profile 隔离证据。',
      next_action: '补齐 Hermes memory-audit 结果',
    },
  ]

  const visibleSections = sections.filter(section => matchesBase(section, base))
  const tenantName = tenantDir ? await readTenantName(tenantDir) : null

  return NextResponse.json({
    phase0_dir: phase0Dir,
    available: true,
    tenants,
    base,
    tenant: {
      tenant_id: tenantId,
      tenant_name: tenantName,
    },
    phase: {
      id: 'P16',
      label: '验收交付',
      description: '按 OC / Hermes / 共享维度汇总需求、构建、闸门、上线准备、UAT 与交接证据。',
    },
    report: buildReportStatus(visibleSections, tenantName || tenantId || 'No tenant', base),
    sections: visibleSections,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
