import 'server-only'

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runCommand } from '@/lib/command'
import { resolveWithin } from '@/lib/paths'
import {
  createEmptyBoundaryRules,
  parseBoundaryRulesRaw,
  stringifyBoundaryRules,
  type BoundaryRules,
} from '@/lib/harness-boundary-schema'

export const BOUNDARY_TENANTS = ['ceo-assistant-v1', 'media-intel-v1', 'web3-research-v1'] as const

export type BoundaryTenant = typeof BOUNDARY_TENANTS[number]

export interface BoundaryRulesState {
  tenant: BoundaryTenant
  tenants: BoundaryTenant[]
  path: string
  exists: boolean
  hash: string | null
  content: string
  rules: BoundaryRules | null
  parse_error: string | null
  writable: boolean
  reload_strategy: 'reload' | 'restart'
}

export interface BoundaryFinalizeResult {
  method: 'reload' | 'restart'
  latency_ms: number
  note: string
}

export function normalizeBoundaryTenant(value: unknown): BoundaryTenant {
  if (typeof value === 'string' && BOUNDARY_TENANTS.includes(value as BoundaryTenant)) {
    return value as BoundaryTenant
  }
  throw new Error(`tenant must be one of: ${BOUNDARY_TENANTS.join(', ')}`)
}

function getDefaultReloadStrategy(): 'reload' | 'restart' {
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

export async function getBoundaryRulesPath(tenant: BoundaryTenant): Promise<string> {
  const root = await resolveHarnessRoot()
  return resolveWithin(root, `phase0/templates/${tenant}/config/boundary-rules.json`)
}

export function computeBoundaryRulesHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

export async function canWriteBoundaryRules(tenant: BoundaryTenant): Promise<boolean> {
  try {
    const filePath = await getBoundaryRulesPath(tenant)
    await access(path.dirname(filePath), constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function readBoundaryRulesFile(tenant: BoundaryTenant): Promise<string | null> {
  try {
    return await readFile(await getBoundaryRulesPath(tenant), 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function readBoundaryRulesState(tenant: BoundaryTenant): Promise<BoundaryRulesState> {
  const filePath = await getBoundaryRulesPath(tenant)
  const writable = await canWriteBoundaryRules(tenant)
  const raw = await readBoundaryRulesFile(tenant)

  if (raw === null) {
    const generated = createEmptyBoundaryRules()
    const content = stringifyBoundaryRules(generated)
    return {
      tenant,
      tenants: [...BOUNDARY_TENANTS],
      path: filePath,
      exists: false,
      hash: null,
      content,
      rules: generated,
      parse_error: null,
      writable,
      reload_strategy: getDefaultReloadStrategy(),
    }
  }

  try {
    const parsed = parseBoundaryRulesRaw(raw)
    return {
      tenant,
      tenants: [...BOUNDARY_TENANTS],
      path: filePath,
      exists: true,
      hash: computeBoundaryRulesHash(raw),
      content: raw,
      rules: parsed,
      parse_error: null,
      writable,
      reload_strategy: getDefaultReloadStrategy(),
    }
  } catch (error: any) {
    return {
      tenant,
      tenants: [...BOUNDARY_TENANTS],
      path: filePath,
      exists: true,
      hash: computeBoundaryRulesHash(raw),
      content: raw,
      rules: null,
      parse_error: error?.message || 'Failed to parse boundary-rules.json',
      writable,
      reload_strategy: getDefaultReloadStrategy(),
    }
  }
}

export async function writeBoundaryRulesFile(tenant: BoundaryTenant, raw: string) {
  const filePath = await getBoundaryRulesPath(tenant)
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

export async function deleteBoundaryRulesFile(tenant: BoundaryTenant) {
  await rm(await getBoundaryRulesPath(tenant), { force: true })
}

export async function finalizeBoundaryRulesUpdate(tenant: BoundaryTenant, raw: string): Promise<BoundaryFinalizeResult> {
  const startedAt = Date.now()
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
