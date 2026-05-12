import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { normalizeCustomerTenantId } from '@/lib/customer-intake'
import { resolveWithin } from '@/lib/paths'

const MOCK_FALLBACK_NOTE = 'Docker daemon 不可用或 new-tenant.sh 缺失，走 mock 模式让 dry run 流程通过；真客户上线时配置 docker-compose.yml + new-tenant.sh'

export interface CustomerDeployStatus {
  status: 'success' | 'mock-success' | 'failed'
  mode: 'new-tenant-script' | 'mock-fallback'
  container: string
  deployed_at: string
  vault_initialized: boolean
  note: string
  script_path?: string
  stdout?: string
  stderr?: string
}

export interface CustomerDeployState {
  tenantId: string
  tenantRoot: string
  confirmationPath: string
  confirmationExists: boolean
  confirmationPreview: string
  deployStatusPath: string
  deployStatus: CustomerDeployStatus | null
  vaultTree: VaultTreeNode[]
  workspaceTree: VaultTreeNode[]
  openclawConfig: Record<string, unknown> | null
}

export interface CustomerDeployResult extends CustomerDeployState {
  alreadyDeployed: boolean
  container: string
  deployStatus: CustomerDeployStatus
}

export interface VaultTreeNode {
  path: string
  name: string
  type: 'directory' | 'file'
  children?: VaultTreeNode[]
}

interface ScriptResult {
  code: number
  stdout: string
  stderr: string
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function directoryExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory()
  } catch {
    return false
  }
}

function parseContainerName(output: string, tenantId: string): string {
  const patterns = [
    /container(?:_name)?\s*[:=]\s*["']?([a-zA-Z0-9_.:-]+)["']?/i,
    /CONTAINER(?:_NAME)?\s*=\s*["']?([a-zA-Z0-9_.:-]+)["']?/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(output)
    if (match?.[1]) return match[1]
  }
  return `tenant-${tenantId}`
}

async function resolveCustomerDeployPaths(tenantId: string) {
  const normalizedTenantId = normalizeCustomerTenantId(tenantId)
  const harnessRoot = await resolveHarnessRoot()
  const tenantRoot = resolveWithin(harnessRoot, `phase0/tenants/${normalizedTenantId}`)
  const vaultRoot = resolveWithin(tenantRoot, 'vault')
  return {
    tenantId: normalizedTenantId,
    harnessRoot,
    tenantRoot,
    vaultRoot,
    confirmationPath: resolveWithin(vaultRoot, 'confirmation-cc.md'),
    deployStatusPath: resolveWithin(tenantRoot, 'deploy-status.json'),
    deployStatusRelativePath: `phase0/tenants/${normalizedTenantId}/deploy-status.json`,
  }
}

async function copyVaultTemplateIfPresent(harnessRoot: string, vaultRoot: string): Promise<void> {
  const templateRoot = resolveWithin(harnessRoot, 'phase0/templates/vault-template')
  if (!await directoryExists(templateRoot)) return
  await cp(templateRoot, vaultRoot, {
    recursive: true,
    force: false,
    errorOnExist: false,
  })
}

async function ensureTenantTree(paths: Awaited<ReturnType<typeof resolveCustomerDeployPaths>>): Promise<void> {
  await mkdir(paths.vaultRoot, { recursive: true })
  await Promise.all([
    mkdir(resolveWithin(paths.tenantRoot, 'config'), { recursive: true }),
    mkdir(resolveWithin(paths.tenantRoot, 'tests'), { recursive: true }),
    mkdir(resolveWithin(paths.tenantRoot, 'skills'), { recursive: true }),
    mkdir(resolveWithin(paths.tenantRoot, 'tenant'), { recursive: true }),
    mkdir(resolveWithin(paths.vaultRoot, 'Agent-Shared'), { recursive: true }),
    mkdir(resolveWithin(paths.vaultRoot, 'Agent-Main'), { recursive: true }),
    mkdir(resolveWithin(paths.vaultRoot, 'Agent-MediaIntel'), { recursive: true }),
    mkdir(resolveWithin(paths.vaultRoot, 'Agent-Web3Research'), { recursive: true }),
    mkdir(resolveWithin(paths.vaultRoot, 'skills'), { recursive: true }),
  ])
  await copyVaultTemplateIfPresent(paths.harnessRoot, paths.vaultRoot)

  const varsPath = resolveWithin(paths.tenantRoot, 'tenant/vars.json')
  if (!await fileExists(varsPath)) {
    await writeFile(varsPath, `${JSON.stringify({ tenant_id: paths.tenantId }, null, 2)}\n`, 'utf8')
  }

  const agentsPath = resolveWithin(paths.tenantRoot, 'AGENTS.base.md')
  if (!await fileExists(agentsPath)) {
    await writeFile(agentsPath, `# AGENTS.base.md\n\nTenant: ${paths.tenantId}\n\nOB-S5 will populate this file.\n`, 'utf8')
  }
}

async function findNewTenantScript(harnessRoot: string): Promise<string | null> {
  const candidates = [
    resolveWithin(harnessRoot, 'phase0/scripts/new-tenant.sh'),
    resolveWithin(harnessRoot, 'phase0/tools/new-tenant.sh'),
  ]
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  return null
}

function runScript(scriptPath: string, tenantId: string): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath, tenantId], {
      cwd: path.dirname(path.dirname(path.dirname(scriptPath))),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      stderr += '\nnew-tenant.sh timed out'
    }, 45_000)
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', error => {
      clearTimeout(timeout)
      resolve({ code: 1, stdout, stderr: stderr || error.message })
    })
    child.on('close', code => {
      clearTimeout(timeout)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function buildMockStatus(tenantId: string, reason: string): CustomerDeployStatus {
  return {
    status: 'mock-success',
    mode: 'mock-fallback',
    container: `tenant-${tenantId}-mock`,
    deployed_at: new Date().toISOString(),
    vault_initialized: true,
    note: reason || MOCK_FALLBACK_NOTE,
  }
}

async function buildScriptStatus(tenantId: string, scriptPath: string, result: ScriptResult): Promise<CustomerDeployStatus> {
  if (result.code !== 0) {
    return buildMockStatus(tenantId, `${MOCK_FALLBACK_NOTE}; new-tenant.sh exited ${result.code}`)
  }
  const output = `${result.stdout}\n${result.stderr}`.trim()
  return {
    status: 'success',
    mode: 'new-tenant-script',
    container: parseContainerName(output, tenantId),
    deployed_at: new Date().toISOString(),
    vault_initialized: true,
    note: 'new-tenant.sh completed successfully',
    script_path: scriptPath,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

async function readDeployStatus(filePath: string): Promise<CustomerDeployStatus | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as CustomerDeployStatus
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function readVaultTree(root: string, logicalPrefix = 'vault', depth = 3): Promise<VaultTreeNode[]> {
  if (!await directoryExists(root)) return []
  const entries = await readdir(root, { withFileTypes: true })
  const nodes: VaultTreeNode[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(root, entry.name)
    const logicalPath = `${logicalPrefix}/${entry.name}`
    if (entry.isDirectory()) {
      nodes.push({
        path: logicalPath,
        name: entry.name,
        type: 'directory',
        children: depth > 1 ? await readVaultTree(entryPath, logicalPath, depth - 1) : [],
      })
    } else if (entry.isFile()) {
      nodes.push({
        path: logicalPath,
        name: entry.name,
        type: 'file',
      })
    }
  }
  return nodes
}

async function readOpenclawConfig(tenantRoot: string): Promise<Record<string, unknown> | null> {
  try {
    const configPath = resolveWithin(tenantRoot, 'config/openclaw.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    // Merge harness-meta.json (genesis-harness custom fields) so the UI can display them
    try {
      const metaPath = resolveWithin(tenantRoot, 'config/harness-meta.json')
      const meta = JSON.parse(await readFile(metaPath, 'utf8'))
      if (meta) {
        config.meta = { ...config.meta, ...meta }
        if (meta.platform) config.platform = meta.platform
        if (meta.model_strategy) {
          config.agents = config.agents || {}
          config.agents.defaults = config.agents.defaults || {}
          config.agents.defaults.model = { ...(config.agents.defaults.model || {}), ...meta.model_strategy }
        }
      }
    } catch { /* harness-meta.json is optional */ }
    return config
  } catch {
    return null
  }
}

export async function readCustomerDeployState(tenantId: string): Promise<CustomerDeployState> {
  const paths = await resolveCustomerDeployPaths(tenantId)
  const confirmationExists = await fileExists(paths.confirmationPath)
  const confirmationContent = confirmationExists ? await readFile(paths.confirmationPath, 'utf8') : ''
  const workspaceRoot = resolveWithin(paths.tenantRoot, 'workspace')
  return {
    tenantId: paths.tenantId,
    tenantRoot: `phase0/tenants/${paths.tenantId}`,
    confirmationPath: `phase0/tenants/${paths.tenantId}/vault/confirmation-cc.md`,
    confirmationExists,
    confirmationPreview: confirmationContent.split('\n').slice(0, 18).join('\n'),
    deployStatusPath: paths.deployStatusRelativePath,
    deployStatus: await readDeployStatus(paths.deployStatusPath),
    vaultTree: await readVaultTree(paths.vaultRoot),
    workspaceTree: await readVaultTree(workspaceRoot, 'workspace'),
    openclawConfig: await readOpenclawConfig(paths.tenantRoot),
  }
}

export async function deployCustomerTenant(tenantIdInput: string): Promise<CustomerDeployResult> {
  const paths = await resolveCustomerDeployPaths(tenantIdInput)
  if (!await fileExists(paths.confirmationPath)) {
    throw new Error('vault/confirmation-cc.md is required before OB-S4 deployment')
  }

  const existingStatus = await readDeployStatus(paths.deployStatusPath)
  if (existingStatus?.status === 'success' || existingStatus?.status === 'mock-success') {
    return {
      ...await readCustomerDeployState(paths.tenantId),
      alreadyDeployed: true,
      container: existingStatus.container,
      deployStatus: existingStatus,
    }
  }

  await ensureTenantTree(paths)

  const scriptPath = await findNewTenantScript(paths.harnessRoot)
  const deployStatus = scriptPath
    ? await buildScriptStatus(paths.tenantId, scriptPath, await runScript(scriptPath, paths.tenantId))
    : buildMockStatus(paths.tenantId, MOCK_FALLBACK_NOTE)

  await writeFile(paths.deployStatusPath, `${JSON.stringify(deployStatus, null, 2)}\n`, 'utf8')

  return {
    ...await readCustomerDeployState(paths.tenantId),
    alreadyDeployed: false,
    container: deployStatus.container,
    deployStatus,
  }
}
