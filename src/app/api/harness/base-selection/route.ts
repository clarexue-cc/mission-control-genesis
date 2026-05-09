import { NextRequest, NextResponse } from 'next/server'
import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

interface BaseOption {
  id: string
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

function buildOptions(platformReady: boolean, templates: string[]): BaseOption[] {
  const templateEvidence = templates.length > 0
    ? [`${templates.length} 个模板: ${templates.join(', ')}`]
    : []

  return [
    {
      id: 'phase0-tenant-container',
      label: 'Phase0 Tenant Container',
      status: platformReady ? 'recommended' : 'blocked',
      isolation: '1 客户 = 1 tenant 工作区',
      channels: ['Telegram', 'Lark', 'WeChat', 'OpenClaw Gateway'],
      evidence: ['phase0/tenants 可读', ...templateEvidence],
      blockers: platformReady ? [] : ['平台就绪检查未全部通过'],
    },
    {
      id: 'dedicated-openclaw-stack',
      label: 'Dedicated OpenClaw Stack',
      status: platformReady ? 'available' : 'blocked',
      isolation: '专属 OpenClaw 配置与运行目录',
      channels: ['Telegram', 'Lark', 'WeChat'],
      evidence: ['适合强隔离客户', ...templateEvidence],
      blockers: platformReady ? ['需要单独分配端口、密钥和运行进程'] : ['平台就绪检查未全部通过'],
    },
    {
      id: 'template-only-draft',
      label: 'Template-only Draft',
      status: templates.length > 0 ? 'available' : 'blocked',
      isolation: '只生成方案和文件，不启动运行底座',
      channels: ['Docs', 'Vault'],
      evidence: templateEvidence,
      blockers: templates.length > 0 ? ['不提供实时通道验证'] : ['未发现可用模板'],
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
