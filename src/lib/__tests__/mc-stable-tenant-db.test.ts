import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }
let tempDir = ''

describe('fixed dev preview tenant seeding', () => {
  beforeEach(() => {
    vi.resetModules()
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-stable-tenant-db-'))
    process.env = {
      ...originalEnv,
      MC_STABLE_FIXED: '1',
      MISSION_CONTROL_TEST_MODE: '1',
      MISSION_CONTROL_DATA_DIR: path.join(tempDir, 'data'),
      MISSION_CONTROL_DB_PATH: path.join(tempDir, 'data', 'mission-control.db'),
    }
    delete process.env.AUTH_USER
    delete process.env.AUTH_PASS
    delete process.env.AUTH_PASS_B64
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

  it('seeds ceo-assistant-v1 and links the default workspace to it', async () => {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()

    const tenant = db.prepare('SELECT id, slug, display_name, status FROM tenants WHERE slug = ?').get('ceo-assistant-v1') as {
      id: number
      slug: string
      display_name: string
      status: string
    } | undefined
    expect(tenant).toMatchObject({
      slug: 'ceo-assistant-v1',
      display_name: 'ceo-assistant-v1',
      status: 'active',
    })

    const workspace = db.prepare('SELECT tenant_id FROM workspaces WHERE id = 1').get() as { tenant_id: number } | undefined
    expect(workspace?.tenant_id).toBe(tenant?.id)
  })
})
