import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

describe('POST /api/harness/run-test', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''
  let runnerPath = ''

  function user(role: 'admin' | 'operator' | 'viewer') {
    return {
      id: 1,
      username: role,
      display_name: role,
      role,
      workspace_id: 1,
      tenant_id: 1,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
    }
  }

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/harness/run-test/route')
  }

  function request(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/harness/run-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  function abortableRequest(body: Record<string, unknown>) {
    const base = request(body)
    const listeners = new Set<() => void>()
    const signal = {
      aborted: false,
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'abort') listeners.add(listener)
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'abort') listeners.delete(listener)
      }),
    }
    return {
      request: new Proxy(base, {
        get(target, prop, receiver) {
          if (prop === 'signal') return signal
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      }) as NextRequest,
      abort: () => {
        signal.aborted = true
        for (const listener of listeners) listener()
      },
      signal,
    }
  }

  async function writeRunner(source: string) {
    await mkdir(path.dirname(runnerPath), { recursive: true })
    await writeFile(runnerPath, source, 'utf8')
  }

  function parseEvents(text: string) {
    return text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mc-run-test-route-'))
    runnerPath = path.join(tempDir, 'tools', 'tg-test-runner.ts')
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: tempDir,
      MC_HARNESS_TEST_RUNNER: runnerPath,
    }
    authMock.requireRole.mockReset()
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('streams a normal Golden run through completion without throwing', async () => {
    await writeRunner(`
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv
const output = args[args.indexOf('--output') + 1]
const emit = (event) => console.log('[runner:event] ' + JSON.stringify(event))
fs.mkdirSync(path.dirname(output), { recursive: true })
emit({ type: 'run_started', total: 10 })
for (let index = 1; index <= 10; index += 1) {
  emit({ type: 'case_started', index, case_id: 'golden-' + index, title: 'Golden ' + index })
  emit({ type: 'case_finished', index, case_id: 'golden-' + index, title: 'Golden ' + index, passed: true, duration_ms: 1, http_status: 200 })
}
fs.writeFileSync(output, '# Golden 10 passed\\n')
emit({ type: 'run_finished', total: 10, failed: 0 })
`)
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant: 'tenant-tg-001', suite: 'golden', delay_ms: 0, timeout_ms: 1000 }))
    const text = await response.text()
    const events = parseEvents(text)
    const outputPath = events.find(event => event.type === 'run_accepted')?.output_path

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'admin')
    expect(events.filter(event => event.type === 'case_finished')).toHaveLength(10)
    expect(events.some(event => event.type === 'run_finished' && event.failed === 0)).toBe(true)
    expect(events.some(event => event.type === 'process_closed' && event.status === 'completed')).toBe(true)
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('Golden 10 passed')
  })

  it('does not enqueue after client abort closes the response stream', async () => {
    await writeRunner(`
const emit = (event) => console.log('[runner:event] ' + JSON.stringify(event))
emit({ type: 'run_started', total: 10 })
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 5))
setInterval(() => {}, 1000)
`)
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    const { POST } = await loadRoute()
    const abortable = abortableRequest({ tenant: 'tenant-tg-001', suite: 'golden' })

    const response = await POST(abortable.request)
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()

    await reader?.read()
    abortable.abort()
    await expect(reader?.cancel()).resolves.not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(abortable.signal.removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('swallows enqueue attempts after the stream has been closed', async () => {
    const { __testables } = await loadRoute()
    const lifecycle = { isClosed: false }
    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()

    expect(__testables.safeClose(lifecycle, controller)).toBe(true)
    expect(__testables.safeEnqueue(lifecycle, controller, encoder, { type: 'log', run_id: 'run-1' })).toBe(false)
    expect(controller.enqueue).not.toHaveBeenCalled()
  })

  it('handles repeated close calls without touching the closed controller again', async () => {
    const { __testables } = await loadRoute()
    const lifecycle = { isClosed: false }
    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController<Uint8Array>

    expect(__testables.safeClose(lifecycle, controller)).toBe(true)
    expect(__testables.safeClose(lifecycle, controller)).toBe(false)
    expect(controller.close).toHaveBeenCalledTimes(1)
  })

  it('marks the stream closed when enqueue throws a closed-controller error', async () => {
    const { __testables } = await loadRoute()
    const lifecycle = { isClosed: false }
    const controller = {
      enqueue: vi.fn(() => {
        throw new TypeError('Invalid state: Controller is already closed')
      }),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()

    expect(__testables.safeEnqueue(lifecycle, controller, encoder, { type: 'log', run_id: 'run-1' })).toBe(false)
    expect(lifecycle.isClosed).toBe(true)
  })

  it('requires admin access before starting a runner process', async () => {
    authMock.requireRole.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { POST } = await loadRoute()

    const response = await POST(request({ tenant: 'tenant-tg-001', suite: 'golden' }))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Authentication required')
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'admin')
  })
})
