import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }
let tempDir = ''

describe('POST /api/auth/login fixed dev preview account', () => {
  beforeEach(() => {
    vi.resetModules()
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mc-login-fixed-dev-'))
    process.env = {
      ...originalEnv,
      NODE_ENV: 'development',
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

  it('seeds clare-admin / dev-test-123 and returns admin content on login', async () => {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()

    const seeded = db.prepare('SELECT username, role FROM users ORDER BY id ASC').all() as Array<{ username: string; role: string }>
    expect(seeded).toEqual([{ username: 'clare-admin', role: 'admin' }])

    const { POST } = await import('../route')
    const response = await POST(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'clare-admin', password: 'dev-test-123' }),
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.user).toMatchObject({
      username: 'clare-admin',
      role: 'admin',
      provider: 'local',
    })
  })

  it('does not seed the legacy admin account in fixed dev preview mode', async () => {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()

    const legacy = db.prepare('SELECT username FROM users WHERE username = ?').get('admin')
    expect(legacy).toBeUndefined()
  })
})
