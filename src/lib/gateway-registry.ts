import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'
import { getDatabase } from './db'
import { getDetectedGatewayPort, getDetectedGatewayToken } from './gateway-runtime'
import { parseJsonRelaxed } from './json-relaxed'

export interface GatewayRecord {
  id: number
  name: string
  host: string
  port: number
  token: string
  is_primary: number
  status?: string
}

export interface GatewayConfigSource {
  configPath: string
  gateway?: GatewayRecord
  gatewayId?: number
  gatewayName?: string
  stateDir?: string
  workspaceRoot?: string
  containerWorkspaceDir?: string
}

interface ConfigSummary {
  configPath: string
  parsed: any
  gatewayPort: number | null
  tenantId: string
  tenantRoot: string | null
}

export function ensureGatewaysTable(db: ReturnType<typeof getDatabase>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gateways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL DEFAULT 18789,
      token TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_seen INTEGER,
      latency INTEGER,
      sessions_count INTEGER NOT NULL DEFAULT 0,
      agents_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)
}

export function listRegisteredGateways(): GatewayRecord[] {
  try {
    const db = getDatabase()
    ensureGatewaysTable(db)
    const rows = db.prepare(
      'SELECT id, name, host, port, token, is_primary, status FROM gateways ORDER BY is_primary DESC, name ASC',
    ).all() as GatewayRecord[]
    if (rows.length > 0) return rows
  } catch {
    // Fall back to env/config below when DB is not ready.
  }

  const port = getDetectedGatewayPort() || config.gatewayPort
  return [{
    id: 0,
    name: String(process.env.MC_DEFAULT_GATEWAY_NAME || 'primary'),
    host: config.gatewayHost,
    port,
    token: getDetectedGatewayToken(),
    is_primary: 1,
    status: 'unknown',
  }]
}

export function getRegisteredGatewayById(id: number): GatewayRecord | null {
  if (!Number.isInteger(id) || id < 1) return null
  return listRegisteredGateways().find((gateway) => gateway.id === id) || null
}

function splitConfiguredPaths(raw: string): string[] {
  return raw
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function addExistingFile(paths: Set<string>, filePath: string | undefined) {
  if (!filePath) return
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      paths.add(path.resolve(filePath))
    }
  } catch {
    // ignore inaccessible candidates
  }
}

function addTenantConfigs(paths: Set<string>, root: string | undefined) {
  if (!root) return
  try {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      addExistingFile(paths, path.join(root, entry.name, 'config', 'openclaw.json'))
    }
  } catch {
    // ignore inaccessible roots
  }
}

export function discoverOpenClawConfigPaths(): string[] {
  const paths = new Set<string>()

  addExistingFile(paths, config.openclawConfigPath)
  addExistingFile(paths, path.join(process.cwd(), '.openclaw', 'openclaw.json'))
  addExistingFile(paths, '/app/.openclaw/openclaw.json')

  for (const envName of ['MISSION_CONTROL_OPENCLAW_CONFIG_PATHS', 'MC_OPENCLAW_CONFIG_PATHS']) {
    for (const configuredPath of splitConfiguredPaths(process.env[envName] || '')) {
      addExistingFile(paths, configuredPath)
    }
  }

  const configuredTenantRoots = splitConfiguredPaths(
    process.env.MISSION_CONTROL_TENANT_ROOTS || process.env.MC_TENANT_ROOTS || '',
  )
  const tenantRoots = [
    ...configuredTenantRoots,
    '/harness/phase0/tenants',
    '/phase0/tenants',
    path.join(process.cwd(), 'phase0', 'tenants'),
  ]
  for (const root of tenantRoots) addTenantConfigs(paths, root)

  return [...paths]
}

function tenantRootFromConfigPath(configPath: string): string | null {
  const configDir = path.dirname(configPath)
  if (path.basename(configDir) !== 'config') return null
  return path.dirname(configDir)
}

function readConfigSummary(configPath: string): ConfigSummary | null {
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = parseJsonRelaxed<any>(raw)
    const tenantRoot = tenantRootFromConfigPath(configPath)
    const tenantId =
      String(parsed?.meta?.tenant_id || '').trim() ||
      (tenantRoot ? path.basename(tenantRoot) : '')
    const gatewayPort = Number(parsed?.gateway?.port || 0)
    return {
      configPath,
      parsed,
      gatewayPort: Number.isFinite(gatewayPort) && gatewayPort > 0 ? gatewayPort : null,
      tenantId,
      tenantRoot,
    }
  } catch {
    return null
  }
}

function sourceFromSummary(summary: ConfigSummary, gateway?: GatewayRecord): GatewayConfigSource {
  const source: GatewayConfigSource = {
    configPath: summary.configPath,
    gateway,
    gatewayId: gateway?.id,
    gatewayName: gateway?.name,
  }

  if (summary.tenantRoot) {
    source.stateDir = path.join(summary.tenantRoot, 'state')
    source.workspaceRoot = path.join(summary.tenantRoot, 'workspace')
    source.containerWorkspaceDir = '/workspace'
  } else {
    source.stateDir = path.dirname(summary.configPath)
  }

  return source
}

export function resolveGatewayConfigSource(gateway: GatewayRecord): GatewayConfigSource | null {
  const summaries = discoverOpenClawConfigPaths()
    .map(readConfigSummary)
    .filter((summary): summary is ConfigSummary => Boolean(summary))

  const byPort = summaries.find((summary) => summary.gatewayPort === Number(gateway.port))
  if (byPort) return sourceFromSummary(byPort, gateway)

  const normalizedName = String(gateway.name || '').trim()
  const byTenantId = summaries.find((summary) => normalizedName && summary.tenantId === normalizedName)
  if (byTenantId) return sourceFromSummary(byTenantId, gateway)

  const configuredDefault = path.resolve(config.openclawConfigPath || '')
  if (gateway.is_primary === 1 && configuredDefault) {
    const primary = summaries.find((summary) => path.resolve(summary.configPath) === configuredDefault)
    if (primary) return sourceFromSummary(primary, gateway)
  }

  return null
}

export function resolveGatewayConfigSources(gatewayId?: number | null): {
  sources: GatewayConfigSource[]
  error?: string
} {
  if (gatewayId != null) {
    const gateway = getRegisteredGatewayById(gatewayId)
    if (!gateway) return { sources: [], error: `Gateway ${gatewayId} not found` }

    const source = resolveGatewayConfigSource(gateway)
    if (!source) return { sources: [], error: `No OpenClaw config found for gateway ${gateway.name}` }
    return { sources: [source] }
  }

  const gateways = listRegisteredGateways()
  const byPath = new Map<string, GatewayConfigSource>()
  for (const gateway of gateways) {
    const source = resolveGatewayConfigSource(gateway)
    if (!source) continue
    byPath.set(path.resolve(source.configPath), source)
  }

  if (byPath.size === 0) {
    const fallbackSummary = readConfigSummary(config.openclawConfigPath)
    if (fallbackSummary) {
      byPath.set(path.resolve(fallbackSummary.configPath), sourceFromSummary(fallbackSummary, gateways[0]))
    }
  }

  const sources = [...byPath.values()]
  if (sources.length === 0) return { sources: [], error: 'No OpenClaw agent configs found' }
  return { sources }
}

export function buildGatewayProcessEnv(
  gateway: GatewayRecord,
  source?: GatewayConfigSource | null,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(source?.configPath ? { OPENCLAW_CONFIG_PATH: source.configPath } : {}),
    ...(source?.stateDir ? { OPENCLAW_STATE_DIR: source.stateDir, OPENCLAW_HOME: path.dirname(source.configPath) } : {}),
    OPENCLAW_GATEWAY_HOST: gateway.host,
    OPENCLAW_GATEWAY_PORT: String(gateway.port),
    ...(gateway.token ? { OPENCLAW_GATEWAY_TOKEN: gateway.token, GATEWAY_TOKEN: gateway.token } : {}),
  }
}
