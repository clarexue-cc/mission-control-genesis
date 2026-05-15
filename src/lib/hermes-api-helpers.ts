import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'

export interface TenantFileResult {
  exists: boolean
  content: string | null
  lines: number
}

export interface TenantDirEntry {
  name: string
  type: 'directory' | 'file'
}

export function normalizeHermesTenantId(value: string | null | undefined): string {
  const normalized = (value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return normalized || 'media-intel-agent'
}

function assertRelativePath(relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error(`Invalid tenant relative path: ${relativePath}`)
  }
}

function countLines(content: string): number {
  if (!content) return 0
  return content.split(/\r\n|\r|\n/).length
}

async function resolveTenantPath(tenantSlug: string, relativePath: string): Promise<string> {
  assertRelativePath(relativePath)
  const root = await resolveHarnessRoot()
  return path.join(root, 'phase0/tenants', normalizeHermesTenantId(tenantSlug), relativePath)
}

export async function readTenantFile(
  tenantSlug: string,
  relativePath: string,
): Promise<TenantFileResult> {
  try {
    const fullPath = await resolveTenantPath(tenantSlug, relativePath)
    const content = await readFile(fullPath, 'utf8')
    return { exists: true, content, lines: countLines(content) }
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { exists: false, content: null, lines: 0 }
    }
    throw error
  }
}

export async function listTenantEntries(
  tenantSlug: string,
  relativePath: string,
): Promise<TenantDirEntry[]> {
  try {
    const fullPath = await resolveTenantPath(tenantSlug, relativePath)
    const entries = await readdir(fullPath, { withFileTypes: true })
    return entries
      .filter(entry => !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' as const : 'file' as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  }
}

export async function listTenantDir(
  tenantSlug: string,
  relativePath: string,
): Promise<string[]> {
  const entries = await listTenantEntries(tenantSlug, relativePath)
  return entries.map(entry => entry.type === 'directory' ? `${entry.name}/` : entry.name)
}
