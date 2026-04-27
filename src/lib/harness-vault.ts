import { constants } from 'node:fs'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { BOUNDARY_TENANTS, normalizeBoundaryTemplateTenant, type BoundaryTenant, resolveHarnessRoot } from '@/lib/harness-boundary'
import { resolveWithin } from '@/lib/paths'

export interface VaultTreeNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  obsidian_path?: string | null
  virtual?: boolean
  children?: VaultTreeNode[]
}

export interface VaultFileContent {
  tenant: BoundaryTenant
  path: string
  name: string
  content: string
  size: number
  modified: number | null
  physical_path: string | null
  obsidian_path: string | null
  obsidian_deeplink: string | null
  virtual: boolean
}

interface VaultSource {
  logicalPrefix: string
  physicalRoot: string
  obsidianPrefix: string | null
}

interface VirtualFile {
  path: string
  content: string
}

const OBSIDIAN_VAULT_NAME = process.env.MC_OBSIDIAN_VAULT_NAME || process.env.OBSIDIAN_VAULT_NAME || 'openclaw'
const OBSIDIAN_VAULT_ROOT = process.env.MC_OBSIDIAN_VAULT_ROOT || process.env.OBSIDIAN_VAULT_ROOT || '/Users/clare/Desktop/obsidian/openclaw'

// TODO: During development, empty tenant agent directories fall back to vault-template/Agent-TEMPLATE below.
const tenantAgentDir: Record<BoundaryTenant, string> = {
  'ceo-assistant-v1': 'Agent-Main',
  'media-intel-v1': 'Agent-MediaIntel',
  'web3-research-v1': 'Agent-Web3Research',
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function isHiddenName(name: string): boolean {
  return name === '.DS_Store' || name === '.git' || name === 'node_modules'
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/')
}

function normalizeVaultLogicalPath(logicalPath: string): string {
  if (path.isAbsolute(logicalPath) || path.win32.isAbsolute(logicalPath) || logicalPath.includes('\0')) {
    throw new Error('Invalid vault path')
  }

  const normalizedPath = logicalPath.replace(/\\/g, '/')
  const segments = normalizedPath.split('/').filter(Boolean)
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error('Invalid vault path')
  }

  return segments.join('/')
}

function obsidianDeeplink(obsidianPath: string | null): string | null {
  if (!obsidianPath) return null
  const vault = encodeURIComponent(OBSIDIAN_VAULT_NAME)
  const file = encodeURIComponent(obsidianPath)
  return `obsidian://open?vault=${vault}&file=${file}`
}

async function buildFileTree(source: VaultSource, dirPath: string, logicalPath: string, maxDepth: number): Promise<VaultTreeNode[]> {
  if (maxDepth < 0) return []

  const items = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
  const nodes: VaultTreeNode[] = []

  for (const item of items) {
    if (item.isSymbolicLink() || isHiddenName(item.name)) continue
    const itemPath = path.join(dirPath, item.name)
    const itemLogicalPath = toPosixPath(path.join(logicalPath, item.name))
    const stats = await stat(itemPath).catch(() => null)
    if (!stats) continue

    const obsidianPath = source.obsidianPrefix
      ? toPosixPath(path.join(source.obsidianPrefix, path.relative(source.physicalRoot, itemPath)))
      : null

    if (item.isDirectory()) {
      nodes.push({
        path: itemLogicalPath,
        name: item.name,
        type: 'directory',
        modified: stats.mtime.getTime(),
        obsidian_path: obsidianPath,
        children: await buildFileTree(source, itemPath, itemLogicalPath, maxDepth - 1),
      })
    } else if (item.isFile()) {
      nodes.push({
        path: itemLogicalPath,
        name: item.name,
        type: 'file',
        size: stats.size,
        modified: stats.mtime.getTime(),
        obsidian_path: obsidianPath,
      })
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function getVaultSources(tenant: BoundaryTenant): Promise<VaultSource[]> {
  const harnessRoot = await resolveHarnessRoot()
  const vaultTemplateRoot = resolveWithin(harnessRoot, 'phase0/templates/vault-template')
  const tenantTemplateRoot = resolveWithin(harnessRoot, `phase0/templates/${tenant}`)
  const tenantWorkspaceRoot = resolveWithin(harnessRoot, `phase0/tenants/${tenant}/workspace`)
  const agentDir = tenantAgentDir[tenant]
  const sources: VaultSource[] = []

  const sharedRoot = await exists(path.join(OBSIDIAN_VAULT_ROOT, 'Agent-Shared'))
    ? path.join(OBSIDIAN_VAULT_ROOT, 'Agent-Shared')
    : path.join(vaultTemplateRoot, 'Agent-Shared')
  sources.push({
    logicalPrefix: 'Agent-Shared',
    physicalRoot: sharedRoot,
    obsidianPrefix: sharedRoot.startsWith(OBSIDIAN_VAULT_ROOT) ? 'Agent-Shared' : null,
  })

  const agentRoot = await exists(path.join(OBSIDIAN_VAULT_ROOT, agentDir))
    ? path.join(OBSIDIAN_VAULT_ROOT, agentDir)
    : path.join(vaultTemplateRoot, 'Agent-TEMPLATE')
  sources.push({
    logicalPrefix: agentDir,
    physicalRoot: agentRoot,
    obsidianPrefix: agentRoot.startsWith(OBSIDIAN_VAULT_ROOT) ? agentDir : null,
  })

  const skillsRoot = await exists(path.join(tenantWorkspaceRoot, 'skills'))
    ? path.join(tenantWorkspaceRoot, 'skills')
    : await exists(path.join(tenantTemplateRoot, 'skills'))
      ? path.join(tenantTemplateRoot, 'skills')
      : path.join(OBSIDIAN_VAULT_ROOT, 'skills')
  sources.push({
    logicalPrefix: 'skills',
    physicalRoot: skillsRoot,
    obsidianPrefix: skillsRoot.startsWith(OBSIDIAN_VAULT_ROOT) ? 'skills' : null,
  })

  return sources
}

function virtualIntakeFiles(tenant: BoundaryTenant): VirtualFile[] {
  return [
    {
      path: 'intake-raw.md',
      content: `# Intake Raw\n\nTenant: ${tenant}\n\nNo tenant-specific intake-raw.md exists yet. This placeholder marks the required customer interview capture node for the full lifecycle flow.\n\nExpected content:\n- customer original words\n- common jobs\n- positive examples\n- negative examples\n- boundaries\n- channels\n- budget\n`,
    },
    {
      path: 'intake-analysis.md',
      content: `# Intake Analysis\n\nTenant: ${tenant}\n\nNo tenant-specific intake-analysis.md exists yet. This placeholder marks the required analysis node before SOUL / AGENTS.md / skills generation.\n\nExpected content:\n- Pipeline / Toolkit / Hybrid decision\n- candidate skills\n- quality standards\n- boundary draft\n- approval gates\n- UAT criteria\n`,
    },
  ]
}

async function resolveIntakeFile(tenant: BoundaryTenant, fileName: string): Promise<{ physicalPath: string | null; virtual: VirtualFile | null }> {
  const harnessRoot = await resolveHarnessRoot()
  const candidates = [
    resolveWithin(harnessRoot, `phase0/templates/${tenant}/vault/${fileName}`),
    resolveWithin(harnessRoot, `phase0/tenants/${tenant}/workspace/vault/${fileName}`),
    resolveWithin(harnessRoot, `phase0/tenants/${tenant}/vault/${fileName}`),
  ]

  for (const candidate of candidates) {
    if (await exists(candidate)) return { physicalPath: candidate, virtual: null }
  }

  return {
    physicalPath: null,
    virtual: virtualIntakeFiles(tenant).find(file => file.path === fileName) || null,
  }
}

export async function readVaultTree(tenant: BoundaryTenant, maxDepth = 6) {
  tenant = normalizeBoundaryTemplateTenant(tenant)
  const sources = await getVaultSources(tenant)
  const roots: VaultTreeNode[] = []

  for (const source of sources) {
    const stats = await stat(source.physicalRoot).catch(() => null)
    if (!stats?.isDirectory()) continue
    roots.push({
      path: source.logicalPrefix,
      name: source.logicalPrefix,
      type: 'directory',
      modified: stats.mtime.getTime(),
      obsidian_path: source.obsidianPrefix,
      children: await buildFileTree(source, source.physicalRoot, source.logicalPrefix, maxDepth - 1),
    })
  }

  for (const fileName of ['intake-raw.md', 'intake-analysis.md']) {
    const resolved = await resolveIntakeFile(tenant, fileName)
    if (resolved.physicalPath) {
      const stats = await stat(resolved.physicalPath)
      roots.push({
        path: fileName,
        name: fileName,
        type: 'file',
        size: stats.size,
        modified: stats.mtime.getTime(),
        obsidian_path: null,
      })
    } else if (resolved.virtual) {
      roots.push({
        path: fileName,
        name: fileName,
        type: 'file',
        size: Buffer.byteLength(resolved.virtual.content),
        modified: Date.now(),
        obsidian_path: null,
        virtual: true,
      })
    }
  }

  return {
    tenant,
    tenants: [...BOUNDARY_TENANTS],
    obsidian_vault_name: OBSIDIAN_VAULT_NAME,
    obsidian_vault_root: OBSIDIAN_VAULT_ROOT,
    tree: roots,
  }
}

export async function readVaultFile(tenant: BoundaryTenant, logicalPath: string): Promise<VaultFileContent> {
  tenant = normalizeBoundaryTemplateTenant(tenant)
  const normalizedPath = normalizeVaultLogicalPath(logicalPath)

  if (normalizedPath === 'intake-raw.md' || normalizedPath === 'intake-analysis.md') {
    const resolved = await resolveIntakeFile(tenant, normalizedPath)
    if (resolved.virtual) {
      return {
        tenant,
        path: normalizedPath,
        name: path.basename(normalizedPath),
        content: resolved.virtual.content,
        size: Buffer.byteLength(resolved.virtual.content),
        modified: null,
        physical_path: null,
        obsidian_path: null,
        obsidian_deeplink: null,
        virtual: true,
      }
    }
    if (!resolved.physicalPath) throw new Error('Vault file not found')
    const content = await readFile(resolved.physicalPath, 'utf8')
    const stats = await stat(resolved.physicalPath)
    return {
      tenant,
      path: normalizedPath,
      name: path.basename(normalizedPath),
      content,
      size: stats.size,
      modified: stats.mtime.getTime(),
      physical_path: resolved.physicalPath,
      obsidian_path: null,
      obsidian_deeplink: null,
      virtual: false,
    }
  }

  const sources = await getVaultSources(tenant)
  for (const source of sources) {
    if (normalizedPath !== source.logicalPrefix && !normalizedPath.startsWith(`${source.logicalPrefix}/`)) {
      continue
    }
    const relativePath = normalizedPath === source.logicalPrefix ? '' : normalizedPath.slice(source.logicalPrefix.length + 1)
    const physicalPath = resolveWithin(source.physicalRoot, relativePath)
    const stats = await stat(physicalPath).catch(() => null)
    if (!stats?.isFile()) throw new Error('Vault file not found')
    const content = await readFile(physicalPath, 'utf8')
    const obsidianPath = source.obsidianPrefix
      ? toPosixPath(path.join(source.obsidianPrefix, relativePath))
      : null
    return {
      tenant,
      path: normalizedPath,
      name: path.basename(normalizedPath),
      content,
      size: stats.size,
      modified: stats.mtime.getTime(),
      physical_path: physicalPath,
      obsidian_path: obsidianPath,
      obsidian_deeplink: obsidianDeeplink(obsidianPath),
      virtual: false,
    }
  }

  throw new Error('Vault file not found')
}
