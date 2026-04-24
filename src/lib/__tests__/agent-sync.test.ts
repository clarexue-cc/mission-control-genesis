import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('removeAgentFromConfig', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  it('removes matching agent entries by id and display name', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-sync-'))
    const configPath = path.join(tempDir, 'openclaw.json')
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: {
            list: [
              { id: 'jarv', name: 'jarv', identity: { name: 'jarv' } },
              { id: 'neo', identity: { name: 'Neo' } },
              { id: 'keep-me', name: 'keep-me', identity: { name: 'keep-me' } },
            ],
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )

    process.env.OPENCLAW_CONFIG_PATH = configPath
    process.env.OPENCLAW_STATE_DIR = tempDir

    const { removeAgentFromConfig } = await import('@/lib/agent-sync')
    const result = await removeAgentFromConfig({ id: 'neo', name: 'Neo' })

    expect(result.removed).toBe(true)
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(parsed.agents.list).toEqual([
      { id: 'jarv', name: 'jarv', identity: { name: 'jarv' } },
      { id: 'keep-me', name: 'keep-me', identity: { name: 'keep-me' } },
    ])
  })

  it('is a no-op when no matching agent entry exists', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-sync-'))
    const configPath = path.join(tempDir, 'openclaw.json')
    writeFileSync(
      configPath,
      JSON.stringify({ agents: { list: [{ id: 'keep-me', name: 'keep-me' }] } }, null, 2) + '\n',
      'utf-8',
    )

    process.env.OPENCLAW_CONFIG_PATH = configPath
    process.env.OPENCLAW_STATE_DIR = tempDir

    const { removeAgentFromConfig } = await import('@/lib/agent-sync')
    const result = await removeAgentFromConfig({ id: 'missing', name: 'missing' })

    expect(result.removed).toBe(false)
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(parsed.agents.list).toEqual([{ id: 'keep-me', name: 'keep-me' }])
  })

  it('normalizes nested model.primary payloads when writing config', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-sync-'))
    const configPath = path.join(tempDir, 'openclaw.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          list: [
            {
              id: 'neo',
              model: {
                primary: {
                  primary: 'anthropic/claude-sonnet-4-20250514',
                },
                fallbacks: ['openai/codex-mini-latest', 'openai/codex-mini-latest'],
              },
            },
          ],
        },
      }, null, 2) + '\n',
      'utf-8',
    )

    process.env.OPENCLAW_CONFIG_PATH = configPath
    process.env.OPENCLAW_STATE_DIR = tempDir

    const { writeAgentToConfig } = await import('@/lib/agent-sync')
    await writeAgentToConfig({
      id: 'neo',
      model: {
        primary: {
          primary: 'anthropic/claude-sonnet-4-20250514',
        },
        fallbacks: ['openrouter/anthropic/claude-sonnet-4'],
      },
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(parsed.agents.list[0].model).toEqual({
      primary: 'anthropic/claude-sonnet-4-20250514',
      fallbacks: ['openrouter/anthropic/claude-sonnet-4'],
    })
  })
})

describe('syncAgentsFromConfig gateway selection', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''

  beforeEach(() => {
    vi.resetModules()
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-sync-gateways-'))
    process.env = {
      ...originalEnv,
      MISSION_CONTROL_TEST_MODE: '1',
      MISSION_CONTROL_DATA_DIR: path.join(tempDir, 'data'),
      MISSION_CONTROL_DB_PATH: path.join(tempDir, 'data', 'mission-control.db'),
      AUTH_PASS: 'strong-test-password-123',
    }
  })

  afterEach(async () => {
    try {
      const { closeDatabase } = await import('@/lib/db')
      closeDatabase()
    } catch {
      // ignore reset races
    }
    process.env = { ...originalEnv }
    vi.resetModules()
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  function writeTenantConfig(tenantId: string, port: number, agentName: string): string {
    const configDir = path.join(tempDir, 'tenants', tenantId, 'config')
    mkdirSync(configDir, { recursive: true })
    mkdirSync(path.join(tempDir, 'tenants', tenantId, 'workspace'), { recursive: true })
    mkdirSync(path.join(tempDir, 'tenants', tenantId, 'state'), { recursive: true })
    const configPath = path.join(configDir, 'openclaw.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        meta: { tenant_id: tenantId },
        gateway: { port },
        agents: {
          list: [
            {
              id: 'main',
              name: agentName,
              default: true,
              workspace: '/workspace',
              agentDir: '/state/agent',
            },
          ],
        },
      }, null, 2) + '\n',
      'utf-8',
    )
    return configPath
  }

  async function seedGateways(configPaths: string[]) {
    process.env.MISSION_CONTROL_OPENCLAW_CONFIG_PATHS = configPaths.join(',')
    process.env.OPENCLAW_CONFIG_PATH = configPaths[0]
    process.env.OPENCLAW_STATE_DIR = path.dirname(configPaths[0])
    process.env.MISSION_CONTROL_TENANT_ROOTS = path.join(tempDir, 'tenants')

    const { getDatabase } = await import('@/lib/db')
    const { ensureGatewaysTable } = await import('@/lib/gateway-registry')
    const db = getDatabase()
    ensureGatewaysTable(db)
    db.prepare(`
      INSERT INTO gateways (id, name, host, port, token, is_primary, status)
      VALUES (?, ?, '127.0.0.1', ?, '', ?, 'online')
    `).run(1, 'tenant-a', 18789, 1)
    db.prepare(`
      INSERT INTO gateways (id, name, host, port, token, is_primary, status)
      VALUES (?, ?, '127.0.0.1', ?, '', ?, 'online')
    `).run(2, 'tenant-b', 18790, 0)
    return db
  }

  it('syncs all registered gateway configs by default', async () => {
    const configA = writeTenantConfig('tenant-a', 18789, 'Alpha Agent')
    const configB = writeTenantConfig('tenant-b', 18790, 'Beta Agent')
    const db = await seedGateways([configA, configB])

    const { syncAgentsFromConfig } = await import('@/lib/agent-sync')
    const result = await syncAgentsFromConfig('test')

    expect(result.error).toBeUndefined()
    expect(result.synced).toBe(2)
    expect(result.created).toBe(2)
    expect(result.agents.map((agent) => agent.name).sort()).toEqual(['Alpha Agent', 'Beta Agent'])

    const rows = db.prepare('SELECT name, config FROM agents ORDER BY name').all() as Array<{ name: string; config: string }>
    expect(rows.map((row) => row.name)).toEqual(['Alpha Agent', 'Beta Agent'])
    expect(JSON.parse(rows[0].config).gateway.name).toBe('tenant-a')
    expect(JSON.parse(rows[1].config).gateway.name).toBe('tenant-b')
  })

  it('honors gatewayId when syncing one gateway', async () => {
    const configA = writeTenantConfig('tenant-a', 18789, 'Alpha Agent')
    const configB = writeTenantConfig('tenant-b', 18790, 'Beta Agent')
    const db = await seedGateways([configA, configB])

    const { syncAgentsFromConfig } = await import('@/lib/agent-sync')
    const result = await syncAgentsFromConfig('test', { gatewayId: 2 })

    expect(result.error).toBeUndefined()
    expect(result.synced).toBe(1)
    expect(result.created).toBe(1)
    expect(result.agents).toEqual([{ id: 'main', name: 'Beta Agent', action: 'created' }])

    const rows = db.prepare('SELECT name FROM agents').all() as Array<{ name: string }>
    expect(rows.map((row) => row.name)).toEqual(['Beta Agent'])
  })
})
