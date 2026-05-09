import { NextRequest, NextResponse } from 'next/server'
import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { customerCheckpointNavItems } from '@/lib/customer-checkpoint-navigation'

export const dynamic = 'force-dynamic'

type PhaseStatus = 'done' | 'current' | 'pending' | 'blocked'

interface PhaseSummary {
  id: string
  label: string
  status: PhaseStatus
  panel: string
  detail: string
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

async function resolvePhase0Dir(): Promise<string | null> {
  const missionControlDir = process.cwd()
  const harnessRoot = await firstReadableDir([
    process.env.MC_HARNESS_ROOT || '',
    process.env.GENESIS_HARNESS_ROOT || '',
    '/Users/clare/Desktop/genesis-harness',
    '/Users/clare/genesis-harness',
    path.resolve(missionControlDir, '..'),
  ].filter(Boolean))

  return firstReadableDir([
    process.env.MC_HARNESS_PHASE0_DIR || '',
    process.env.GENESIS_HARNESS_PHASE0_DIR || '',
    harnessRoot ? path.join(harnessRoot, 'phase0') : '',
    '/Users/clare/Desktop/genesis-harness/phase0',
  ].filter(Boolean))
}

async function countDirectories(targetPath: string): Promise<number> {
  const entries = await readdir(targetPath, { withFileTypes: true }).catch(() => [])
  return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).length
}

function currentPhase(phases: PhaseSummary[]): PhaseSummary {
  return phases.find(phase => phase.status === 'current')
    || phases.find(phase => phase.status === 'blocked')
    || phases[phases.length - 1]
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const tenant = searchParams.get('tenant') || searchParams.get('tenant_id') || null
  const phase0Dir = await resolvePhase0Dir()
  const tenantsDir = phase0Dir ? path.join(phase0Dir, 'tenants') : ''
  const templatesDir = phase0Dir ? path.join(phase0Dir, 'templates') : ''
  const tenantCount = tenantsDir ? await countDirectories(tenantsDir) : 0
  const templateCount = templatesDir ? await countDirectories(templatesDir) : 0
  const platformReady = Boolean(phase0Dir && tenantCount > 0 && templateCount > 0)
  const baseSelected = platformReady

  const phases: PhaseSummary[] = [
    {
      id: 'onboarding-overview',
      label: '全景总览',
      status: 'done',
      panel: 'onboarding/overview',
      detail: tenant ? `当前 tenant: ${tenant}` : '等待选择或创建 tenant',
    },
    {
      id: 'platform-ready',
      label: '平台就绪',
      status: platformReady ? 'done' : 'current',
      panel: 'onboarding/platform-ready',
      detail: platformReady ? 'phase0、tenants、templates 已就绪' : '平台就绪检查未全部通过',
    },
    {
      id: 'base-selection',
      label: '底座选型',
      status: !platformReady ? 'blocked' : baseSelected ? 'done' : 'current',
      panel: 'onboarding/base-selection',
      detail: platformReady ? '默认推荐 Phase0 Tenant Container' : '需先完成平台就绪',
    },
    {
      id: 'delivery-checkpoints',
      label: 'P3-P16 交付链',
      status: platformReady && baseSelected ? 'current' : 'pending',
      panel: 'onboarding/customer',
      detail: '客户接入、蓝图、审批、部署、测试、UAT、交付',
    },
  ]

  return NextResponse.json({
    tenant,
    phase0_dir: phase0Dir,
    platform_ready: platformReady,
    base_selected: baseSelected,
    current_phase: currentPhase(phases),
    phases,
    checkpoints: customerCheckpointNavItems,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
