import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveWithin } from '@/lib/paths'

const HERMES_ALLOWED_WRITE_PATHS = new Set([
  'Agent-Shared/hermes-log.md',
  'Agent-Shared/hermes-alerts.jsonl',
])

export class HermesVaultPermissionError extends Error {
  constructor(relativePath: string) {
    super(`Hermes write denied: ${relativePath}`)
    this.name = 'HermesVaultPermissionError'
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/')
}

function normalizeVaultRelativePath(vaultRoot: string, targetPath: string): string {
  if (path.isAbsolute(targetPath) || path.win32.isAbsolute(targetPath)) {
    const resolvedRoot = path.resolve(vaultRoot)
    const resolvedTarget = path.resolve(targetPath)
    if (!resolvedTarget.startsWith(resolvedRoot + path.sep) && resolvedTarget !== resolvedRoot) {
      throw new Error('Path escapes vault root')
    }
    return toPosixPath(path.relative(resolvedRoot, resolvedTarget))
  }

  if (targetPath.includes('\0')) throw new Error('Invalid vault path')
  const normalized = targetPath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error('Invalid vault path')
  }
  return segments.join('/')
}

export function assertHermesVaultWriteAllowed(vaultRoot: string, targetPath: string): string {
  const relativePath = normalizeVaultRelativePath(vaultRoot, targetPath)
  if (!HERMES_ALLOWED_WRITE_PATHS.has(relativePath)) {
    throw new HermesVaultPermissionError(relativePath)
  }
  return resolveWithin(vaultRoot, relativePath)
}

export function resolveHermesVaultReadPath(vaultRoot: string, targetPath: string): string {
  return resolveWithin(vaultRoot, normalizeVaultRelativePath(vaultRoot, targetPath))
}

export async function writeHermesVaultFile(vaultRoot: string, targetPath: string, content: string): Promise<void> {
  const physicalPath = assertHermesVaultWriteAllowed(vaultRoot, targetPath)
  await mkdir(path.dirname(physicalPath), { recursive: true })
  await writeFile(physicalPath, content, 'utf8')
}

export async function readHermesVaultFile(vaultRoot: string, targetPath: string): Promise<string> {
  return readFile(resolveHermesVaultReadPath(vaultRoot, targetPath), 'utf8')
}
