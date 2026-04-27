import 'server-only'

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runCommand } from '@/lib/command'
import { resolveWithin } from '@/lib/paths'
import { normalizeTenantId } from '@/lib/tenant-id'
import {
  createEmptyBoundaryRules,
  parseBoundaryRulesRaw,
  stringifyBoundaryRules,
  type BoundaryRules,
} from '@/lib/harness-boundary-schema'

export const BOUNDARY_TENANTS = ['ceo-assistant-v1', 'media-intel-v1', 'web3-research-v1'] as const

export type BoundaryTenant = typeof BOUNDARY_TENANTS[number]
export type BoundaryMode = 'full' | 'mock-fallback'
export type BoundaryReloadStrategy = 'reload' | 'restart' | 'mock-fallback'

export interface BoundaryRulesState {
  tenant: string
  tenants: string[]
  path: string
  exists: boolean
  hash: string | null
  content: string
  rules: BoundaryRules | null
  parse_error: string | null
  writable: boolean
  reload_strategy: BoundaryReloadStrategy
  mode: BoundaryMode
  note: string
}

export interface BoundaryFinalizeResult {
  method: BoundaryReloadStrategy
  latency_ms: number
  note: string
}

export function isBoundaryFullModeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.OPENCLAW_GATEWAY_HOST?.trim()
    && env.OPENCLAW_GATEWAY_PORT?.trim()
    && env.OPENCLAW_CONFIG_PATH?.trim()
    && env.OPENCLAW_WORKSPACE_DIR?.trim(),
  )
}

export function getBoundaryMode(env: NodeJS.ProcessEnv = process.env): BoundaryMode {
  return isBoundaryFullModeConfigured(env) ? 'full' : 'mock-fallback'
}

export function normalizeBoundaryTenant(value: unknown, mode: BoundaryMode = getBoundaryMode()): string {
  if (mode === 'mock-fallback') return normalizeTenantId(value)
  if (typeof value === 'string' && BOUNDARY_TENANTS.includes(value as BoundaryTenant)) {
    return value as BoundaryTenant
  }
  throw new Error(`tenant must be one of: ${BOUNDARY_TENANTS.join(', ')}`)
}

export function normalizeBoundaryTemplateTenant(value: unknown): BoundaryTenant {
  return normalizeBoundaryTenant(value, 'full') as BoundaryTenant
}

function getDefaultReloadStrategy(mode = getBoundaryMode()): BoundaryReloadStrategy {
  if (mode === 'mock-fallback') return 'mock-fallback'
  return process.env.MC_HARNESS_RESTART_COMMAND ? 'restart' : 'reload'
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

export async function resolveHarnessRoot(): Promise<string> {
  const candidates = [
    process.env.MC_HARNESS_ROOT,
    process.env.GENESIS_HARNESS_ROOT,
    '/Users/clare/Desktop/genesis-harness',
    path.resolve(process.cwd(), '..', 'genesis-harness'),
    path.resolve(process.cwd(), 'genesis-harness'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  throw new Error('Genesis harness root not found')
}

function uniqueTenants(currentTenant: string): string[] {
  return Array.from(new Set([...BOUNDARY_TENANTS, currentTenant]))
}

function boundaryModeNote(mode: BoundaryMode): string {
  if (mode === 'mock-fallback') {
    return '真 full mode 未配置 OPENCLAW_GATEWAY_HOST/PORT/CONFIG_PATH/WORKSPACE_DIR；使用 dev mock fallback，本地写 phase0/tenants/<tenant>/boundary.yaml。'
  }
  return 'OpenClaw full mode env 已配置；使用 template boundary-rules.json 与现有 reload/restart 逻辑。'
}

export async function getBoundaryRulesPath(tenant: string, mode = getBoundaryMode()): Promise<string> {
  const normalizedTenant = normalizeBoundaryTenant(tenant, mode)
  const root = await resolveHarnessRoot()
  if (mode === 'mock-fallback') {
    return resolveWithin(root, `phase0/tenants/${normalizedTenant}/boundary.yaml`)
  }
  return resolveWithin(root, `phase0/templates/${normalizedTenant}/config/boundary-rules.json`)
}

export function computeBoundaryRulesHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

export async function canWriteBoundaryRules(tenant: string, mode = getBoundaryMode()): Promise<boolean> {
  try {
    if (mode === 'mock-fallback') {
      await access(await resolveHarnessRoot(), constants.W_OK)
      return true
    }
    const filePath = await getBoundaryRulesPath(tenant, mode)
    await access(path.dirname(filePath), constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function readBoundaryRulesFile(tenant: string, mode = getBoundaryMode()): Promise<string | null> {
  try {
    return await readFile(await getBoundaryRulesPath(tenant, mode), 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

async function readMockBoundaryTemplate(root: string): Promise<string | null> {
  try {
    return await readFile(resolveWithin(root, 'phase0/templates/boundary-template.yaml'), 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

export async function readBoundaryRulesState(tenantInput: string): Promise<BoundaryRulesState> {
  const mode = getBoundaryMode()
  const tenant = normalizeBoundaryTenant(tenantInput, mode)
  const root = await resolveHarnessRoot()
  const filePath = await getBoundaryRulesPath(tenant, mode)
  const writable = await canWriteBoundaryRules(tenant, mode)
  const raw = await readBoundaryRulesFile(tenant, mode)
  const reloadStrategy = getDefaultReloadStrategy(mode)
  const note = boundaryModeNote(mode)

  if (raw === null) {
    const generated = createEmptyBoundaryRules()
    const content = mode === 'mock-fallback'
      ? (await readMockBoundaryTemplate(root)) || stringifyBoundaryRules(generated)
      : stringifyBoundaryRules(generated)
    let rules = generated
    let parseError: string | null = null
    try {
      rules = parseBoundaryRulesRaw(content)
    } catch (error: any) {
      parseError = error?.message || 'Failed to parse boundary template'
    }
    return {
      tenant,
      tenants: uniqueTenants(tenant),
      path: filePath,
      exists: false,
      hash: null,
      content,
      rules,
      parse_error: parseError,
      writable,
      reload_strategy: reloadStrategy,
      mode,
      note,
    }
  }

  try {
    const parsed = parseBoundaryRulesRaw(raw)
    return {
      tenant,
      tenants: uniqueTenants(tenant),
      path: filePath,
      exists: true,
      hash: computeBoundaryRulesHash(raw),
      content: raw,
      rules: parsed,
      parse_error: null,
      writable,
      reload_strategy: reloadStrategy,
      mode,
      note,
    }
  } catch (error: any) {
    return {
      tenant,
      tenants: uniqueTenants(tenant),
      path: filePath,
      exists: true,
      hash: computeBoundaryRulesHash(raw),
      content: raw,
      rules: null,
      parse_error: error?.message || 'Failed to parse boundary-rules.json',
      writable,
      reload_strategy: reloadStrategy,
      mode,
      note,
    }
  }
}

export async function writeBoundaryRulesFile(tenant: string, raw: string, mode = getBoundaryMode()) {
  const filePath = await getBoundaryRulesPath(tenant, mode)
  const dirPath = path.dirname(filePath)
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`

  await mkdir(dirPath, { recursive: true })
  try {
    await writeFile(tempPath, raw, 'utf8')
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function deleteBoundaryRulesFile(tenant: string, mode = getBoundaryMode()) {
  await rm(await getBoundaryRulesPath(tenant, mode), { force: true })
}

export async function finalizeBoundaryRulesUpdate(tenant: string, raw: string, mode = getBoundaryMode()): Promise<BoundaryFinalizeResult> {
  const startedAt = Date.now()
  if (mode === 'mock-fallback') {
    return {
      method: 'mock-fallback',
      latency_ms: Date.now() - startedAt,
      note: '已 reload (mock-fallback)：本地 boundary.yaml 已写入；真 full mode 需配置 OPENCLAW_GATEWAY_HOST/PORT/CONFIG_PATH/WORKSPACE_DIR。',
    }
  }
  const reloadUrl = process.env.MC_HARNESS_BOUNDARY_RELOAD_URL?.trim()
  const restartCommand = process.env.MC_HARNESS_RESTART_COMMAND?.trim()

  if (reloadUrl) {
    const response = await fetch(reloadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant, path: `phase0/templates/${tenant}/config/boundary-rules.json`, content: raw }),
    })
    if (!response.ok) {
      throw new Error(`Reload failed (${response.status}): ${await response.text()}`)
    }
    return {
      method: 'reload',
      latency_ms: Date.now() - startedAt,
      note: 'Reloaded via configured HTTP endpoint',
    }
  }

  if (restartCommand) {
    await runCommand('sh', ['-lc', restartCommand], { timeoutMs: 30_000 })
    return {
      method: 'restart',
      latency_ms: Date.now() - startedAt,
      note: 'Restarted runtime via configured shell command',
    }
  }

  return {
    method: 'reload',
    latency_ms: Date.now() - startedAt,
    note: 'Saved template file; harness hot-reload endpoint not configured',
  }
}
