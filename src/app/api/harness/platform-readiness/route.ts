import { NextRequest, NextResponse } from 'next/server'
import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type ReadinessStatus = 'pass' | 'warn' | 'fail'

interface ReadinessCheck {
  id: string
  label: string
  status: ReadinessStatus
  required: boolean
  detail: string
  path?: string
}

async function isReadable(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function firstReadableDir(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await isReadable(candidate)) return candidate
  }
  return null
}

async function countDirectories(targetPath: string): Promise<number> {
  const entries = await readdir(targetPath, { withFileTypes: true }).catch(() => [])
  return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).length
}

function check(id: string, label: string, passed: boolean, required: boolean, detail: string, targetPath?: string): ReadinessCheck {
  return {
    id,
    label,
    status: passed ? 'pass' : required ? 'fail' : 'warn',
    required,
    detail,
    path: targetPath,
  }
}

async function buildReadinessChecks(): Promise<{ phase0Dir: string | null; checks: ReadinessCheck[] }> {
  const missionControlDir = process.cwd()
  const home = os.homedir()
  const harnessRoot = await firstReadableDir([
    process.env.MC_HARNESS_ROOT || '',
    process.env.GENESIS_HARNESS_ROOT || '',
    path.join(home, 'Desktop', 'Claude', 'genesis-harness'),
    path.join(home, 'Desktop', 'genesis-harness'),
    path.join(home, 'genesis-harness'),
    path.resolve(missionControlDir, '..'),
  ].filter(Boolean))

  const phase0Dir = await firstReadableDir([
    process.env.MC_HARNESS_PHASE0_DIR || '',
    process.env.GENESIS_HARNESS_PHASE0_DIR || '',
    harnessRoot ? path.join(harnessRoot, 'phase0') : '',
  ].filter(Boolean))

  const tenantsDir = phase0Dir ? path.join(phase0Dir, 'tenants') : ''
  const templatesDir = phase0Dir ? path.join(phase0Dir, 'templates') : ''
  const statusRoute = path.join(missionControlDir, 'src/app/api/harness/onboarding/status/route.ts')
  const boundaryRoute = path.join(missionControlDir, 'src/app/api/harness/boundary-rules/route.ts')

  const tenantCount = tenantsDir ? await countDirectories(tenantsDir) : 0
  const templateCount = templatesDir ? await countDirectories(templatesDir) : 0
  const missionControlStat = await stat(missionControlDir).catch(() => null)

  const checks: ReadinessCheck[] = [
    check(
      'mission-control',
      'Mission Control',
      Boolean(missionControlStat?.isDirectory()),
      true,
      missionControlStat?.isDirectory() ? '应用目录可读' : '应用目录不可读',
      missionControlDir,
    ),
    check(
      'phase0',
      'Phase0 Harness',
      Boolean(phase0Dir),
      true,
      phase0Dir ? 'phase0 目录已挂载' : '未找到 phase0 目录',
      phase0Dir || undefined,
    ),
    check(
      'tenants',
      'Tenant Vaults',
      Boolean(tenantsDir && await isReadable(tenantsDir)),
      true,
      tenantsDir && await isReadable(tenantsDir)
        ? (tenantCount > 0 ? `发现 ${tenantCount} 个 tenant 目录` : 'tenant 目录就绪（尚无 tenant，P3 创建）')
        : '未发现 tenant 目录',
      tenantsDir || undefined,
    ),
    check(
      'templates',
      'Base Templates',
      templateCount > 0,
      true,
      templateCount > 0 ? `发现 ${templateCount} 个底座模板` : '未发现底座模板',
      templatesDir || undefined,
    ),
    check(
      'boundary-api',
      'Boundary API',
      await isReadable(boundaryRoute),
      true,
      '边界规则 API 文件检查',
      boundaryRoute,
    ),
    check(
      'onboarding-status-api',
      'Onboarding Status API',
      await isReadable(statusRoute),
      false,
      '旧 onboarding status API 文件检查',
      statusRoute,
    ),
  ]

  return { phase0Dir, checks }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { phase0Dir, checks } = await buildReadinessChecks()
  const requiredChecks = checks.filter(item => item.required)
  const ready = requiredChecks.every(item => item.status === 'pass')

  return NextResponse.json({
    ready,
    phase0_dir: phase0Dir,
    checks,
    summary: {
      passed: checks.filter(item => item.status === 'pass').length,
      total: checks.length,
      required_passed: requiredChecks.filter(item => item.status === 'pass').length,
      required_total: requiredChecks.length,
    },
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
