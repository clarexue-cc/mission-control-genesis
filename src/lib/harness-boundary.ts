import 'server-only'

import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { config } from '@/lib/config'
import { resolveWithin } from '@/lib/paths'
import { runCommand } from '@/lib/command'
import {
  createEmptyBoundaryRules,
  parseBoundaryRulesRaw,
  stringifyBoundaryRules,
  type BoundaryRules,
} from '@/lib/harness-boundary-schema'

export interface BoundaryRulesState {
  path: string
  exists: boolean
  hash: string | null
  raw: string
  rules: BoundaryRules | null
  parse_error: string | null
  source: 'workspace' | 'generated'
  writable: boolean
  reload_strategy: 'reload' | 'restart'
}

export interface BoundaryFinalizeResult {
  method: 'reload' | 'restart'
  latency_ms: number
  note: string
}

function getDefaultReloadStrategy(): 'reload' | 'restart' {
  return process.env.MC_HARNESS_RESTART_COMMAND ? 'restart' : 'reload'
}

export function getBoundaryRulesPath(): string {
  if (!config.openclawWorkspaceDir) {
    throw new Error('OPENCLAW_WORKSPACE_DIR not configured')
  }
  return resolveWithin(config.openclawWorkspaceDir, 'config/boundary-rules.json')
}

export function computeBoundaryRulesHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

export async function canWriteBoundaryRules(): Promise<boolean> {
  if (!config.openclawWorkspaceDir) return false
  try {
    await access(config.openclawWorkspaceDir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function readBoundaryRulesFile(): Promise<string | null> {
  try {
    return await readFile(getBoundaryRulesPath(), 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function readBoundaryRulesState(): Promise<BoundaryRulesState> {
  const filePath = getBoundaryRulesPath()
  const writable = await canWriteBoundaryRules()
  const raw = await readBoundaryRulesFile()

  if (raw === null) {
    const generatedRules = createEmptyBoundaryRules()
    const generatedRaw = stringifyBoundaryRules(generatedRules)
    return {
      path: filePath,
      exists: false,
      hash: null,
      raw: generatedRaw,
      rules: generatedRules,
      parse_error: null,
      source: 'generated',
      writable,
      reload_strategy: getDefaultReloadStrategy(),
    }
  }

  try {
    const parsed = parseBoundaryRulesRaw(raw)
    return {
      path: filePath,
      exists: true,
      hash: computeBoundaryRulesHash(raw),
      raw: stringifyBoundaryRules(parsed),
      rules: parsed,
      parse_error: null,
      source: 'workspace',
      writable,
      reload_strategy: getDefaultReloadStrategy(),
    }
  } catch (error: any) {
    return {
      path: filePath,
      exists: true,
      hash: computeBoundaryRulesHash(raw),
      raw,
      rules: null,
      parse_error: error?.message || 'Failed to parse boundary-rules.json',
      source: 'workspace',
      writable,
      reload_strategy: getDefaultReloadStrategy(),
    }
  }
}

export async function writeBoundaryRulesFile(raw: string) {
  const filePath = getBoundaryRulesPath()
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

export async function deleteBoundaryRulesFile() {
  await rm(getBoundaryRulesPath(), { force: true })
}

export async function finalizeBoundaryRulesUpdate(): Promise<BoundaryFinalizeResult> {
  const startedAt = Date.now()
  const reloadUrl = process.env.MC_HARNESS_BOUNDARY_RELOAD_URL?.trim()
  const restartCommand = process.env.MC_HARNESS_RESTART_COMMAND?.trim()

  if (reloadUrl) {
    const response = await fetch(reloadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/workspace/config/boundary-rules.json' }),
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

  // Genesis Harness boundary hook re-reads /workspace/config/boundary-rules.json
  // for each outgoing assistant message, so a file write is enough here.
  return {
    method: 'reload',
    latency_ms: Date.now() - startedAt,
    note: 'Live-read hook detected; no explicit reload required',
  }
}
