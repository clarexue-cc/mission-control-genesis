import { NextRequest, NextResponse } from 'next/server'
import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

interface BaseOption {
  id: 'oc' | 'hermes' | 'both'
  label: string
  status: 'recommended' | 'available' | 'blocked'
  isolation: string
  channels: string[]
  evidence: string[]
  blockers: string[]
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

async function listTemplates(phase0Dir: string | null): Promise<string[]> {
  if (!phase0Dir) return []
  const templatesDir = path.join(phase0Dir, 'templates')
  const entries = await readdir(templatesDir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort()
}

async function resolvePhase0Dir(): Promise<string | null> {
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

  return firstReadableDir([
    process.env.MC_HARNESS_PHASE0_DIR || '',
    process.env.GENESIS_HARNESS_PHASE0_DIR || '',
    harnessRoot ? path.join(harnessRoot, 'phase0') : '',
  ].filter(Boolean))
}

function buildOptions(platformReady: boolean, templates: string[]): BaseOption[] {
  const templateEvidence = templates.length > 0
    ? [`${templates.length} 个模板: ${templates.join(', ')}`]
    : []

  return [
    {
      id: 'oc',
      label: 'OC / OpenClaw',
      status: platformReady ? 'recommended' : 'blocked',
      isolation: '业务 agent 底座，1 客户 = 1 tenant 工作区',
      channels: ['Telegram', 'Lark', 'WeChat', 'OpenClaw Gateway'],
      evidence: ['适合多渠道、SOP、审批网关、硬边界交付', 'phase0/tenants 可读', ...templateEvidence],
      blockers: platformReady ? [] : ['平台就绪检查未全部通过'],
    },
    {
      id: 'hermes',
      label: 'Hermes',
      status: platformReady ? 'available' : 'blocked',
      isolation: '个人/搜索/守护 agent profile 隔离',
      channels: ['Gateway', 'Cron', 'Vault', 'Search'],
      evidence: ['适合搜索整理、定时巡检、个人助理、持续学习', ...templateEvidence],
      blockers: platformReady ? [] : ['平台就绪检查未全部通过'],
    },
    {
      id: 'both',
      label: '双底座',
      status: platformReady ? 'available' : 'blocked',
      isolation: 'OC 负责业务交付，Hermes 负责守护、巡检和研究',
      channels: ['OpenClaw Gateway', 'Hermes Gateway', 'Cron', 'Vault'],
      evidence: ['适合既要客户业务 agent，又要后台守护/投研/巡检的交付', ...templateEvidence],
      blockers: platformReady ? [] : ['平台就绪检查未全部通过'],
    },
  ]
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const phase0Dir = await resolvePhase0Dir()
  const templates = await listTemplates(phase0Dir)
  const platformReady = Boolean(phase0Dir) && templates.length > 0
  const options = buildOptions(platformReady, templates)
  const selected = options.find(option => option.status === 'recommended')?.id
    || options.find(option => option.status === 'available')?.id
    || null

  return NextResponse.json({
    platform_ready: platformReady,
    phase0_dir: phase0Dir,
    templates,
    selected,
    options,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
