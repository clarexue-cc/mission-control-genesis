import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stringifyBoundaryRules, type BoundaryRules } from '@/lib/harness-boundary-schema'

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: () => ({ run: vi.fn() }),
  }),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('server-only', () => ({}))

describe('/api/harness boundary routes', () => {
  const originalEnv = { ...process.env }
  let harnessRoot = ''

  function adminUser() {
    return {
      id: 1,
      username: 'clare-admin',
      display_name: 'Clare Admin',
      role: 'admin',
      workspace_id: 1,
      tenant_id: 1,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
    }
  }

  function rules(label = 'dry run boundary'): BoundaryRules {
    return {
      version: '1.0',
      last_updated: '2026-04-27',
      forbidden_patterns: [{
        id: 'TEST-FORBIDDEN',
        category: 'privacy',
        patterns: ['secret'],
        pattern: 'secret',
        label,
        severity: 'high',
        action: 'block',
        response_template: 'blocked',
      }],
      drift_patterns: [{
        id: 'TEST-DRIFT',
        category: 'quality',
        pattern: 'placeholder',
      }],
    }
  }

  function getRequest(tenant = 'wechat-mp-agent') {
    return new NextRequest(`http://localhost/api/harness/boundary-rules?tenant=${encodeURIComponent(tenant)}`)
  }

  function postRequest(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/harness/boundary-reload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function loadRoutes() {
    vi.resetModules()
    const getRoute = await import('@/app/api/harness/boundary-rules/route')
    const postRoute = await import('@/app/api/harness/boundary-reload/route')
    return { GET: getRoute.GET, POST: postRoute.POST }
  }

  function useFullModeEnv() {
    process.env.OPENCLAW_GATEWAY_HOST = '127.0.0.1'
    process.env.OPENCLAW_GATEWAY_PORT = '18789'
    process.env.OPENCLAW_CONFIG_PATH = path.join(harnessRoot, 'openclaw.json')
    process.env.OPENCLAW_WORKSPACE_DIR = path.join(harnessRoot, 'workspace')
  }

  beforeEach(async () => {
    harnessRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-boundary-route-'))
    await mkdir(path.join(harnessRoot, 'phase0'), { recursive: true })
    await writeFile(path.join(harnessRoot, 'package.json'), '{"name":"harness-test"}\n', 'utf8')
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: harnessRoot,
      OPENCLAW_GATEWAY_HOST: '',
      OPENCLAW_GATEWAY_PORT: '',
      OPENCLAW_CONFIG_PATH: '',
      OPENCLAW_WORKSPACE_DIR: '',
    }
    authMock.requireRole.mockReset()
    authMock.requireRole.mockReturnValue({ user: adminUser() })
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(harnessRoot, { recursive: true, force: true })
  })

  it('reads true full mode when OpenClaw env is configured', async () => {
    useFullModeEnv()
    await mkdir(path.join(harnessRoot, 'phase0/templates/wechat-mp-agent/config'), { recursive: true })
    const { GET } = await loadRoutes()

    const response = await GET(getRequest('wechat-mp-agent'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('full')
    expect(body.reload_strategy).toBe('reload')
    expect(body.path).toContain('phase0/templates/wechat-mp-agent/config/boundary-rules.json')
    expect(body.note).toContain('OpenClaw full mode env')
  })

  it('uses dev mock fallback when OpenClaw env is missing', async () => {
    const { GET } = await loadRoutes()

    const response = await GET(getRequest('demo-dry-run-3'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('mock-fallback')
    expect(body.reload_strategy).toBe('mock-fallback')
    expect(body.path).toContain('phase0/tenants/demo-dry-run-3/boundary.yaml')
    expect(body.note).toContain('mock fallback')
  })

  it('rejects non-admin access', async () => {
    authMock.requireRole.mockReturnValue({ error: 'Requires admin role or higher', status: 403 })
    const { GET, POST } = await loadRoutes()

    const getResponse = await GET(getRequest())
    const postResponse = await POST(postRequest({ tenant: 'demo-dry-run-3', content: stringifyBoundaryRules(rules()) }))

    expect(getResponse.status).toBe(403)
    expect(postResponse.status).toBe(403)
  })

  it('writes boundary.yaml successfully in mock fallback mode', async () => {
    const content = stringifyBoundaryRules(rules('mock save success'))
    const { POST } = await loadRoutes()

    const response = await POST(postRequest({ tenant: 'demo-dry-run-3', content, hash: null }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('mock-fallback')
    expect(body.method).toBe('mock-fallback')
    expect(body.note).toContain('已 reload (mock-fallback)')
    const outputPath = path.join(harnessRoot, 'phase0/tenants/demo-dry-run-3/boundary.yaml')
    await expect(stat(outputPath)).resolves.toBeTruthy()
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('mock save success')
  })

  it('writes the full-mode template path without mock fallback when env is configured', async () => {
    useFullModeEnv()
    await mkdir(path.join(harnessRoot, 'phase0/templates/wechat-mp-agent/config'), { recursive: true })
    const content = stringifyBoundaryRules(rules('full save success'))
    const { POST } = await loadRoutes()

    const response = await POST(postRequest({ tenant: 'wechat-mp-agent', content }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('full')
    expect(body.method).toBe('reload')
    expect(body.note).not.toContain('mock-fallback')
    const outputPath = path.join(harnessRoot, 'phase0/templates/wechat-mp-agent/config/boundary-rules.json')
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('full save success')
  })

  it('returns a graceful error when mock fallback cannot write boundary.yaml', async () => {
    await mkdir(path.join(harnessRoot, 'phase0/tenants'), { recursive: true })
    await writeFile(path.join(harnessRoot, 'phase0/tenants/demo-fail'), 'not a directory', 'utf8')
    const { POST } = await loadRoutes()

    const response = await POST(postRequest({ tenant: 'demo-fail', content: stringifyBoundaryRules(rules()) }))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBeTruthy()
  })

  it('switches mode based on OpenClaw env completeness', async () => {
    const { isBoundaryFullModeConfigured } = await import('@/lib/harness-boundary')
    expect(isBoundaryFullModeConfigured({
      OPENCLAW_GATEWAY_HOST: '127.0.0.1',
      OPENCLAW_GATEWAY_PORT: '18789',
      OPENCLAW_CONFIG_PATH: '/tmp/openclaw.json',
      OPENCLAW_WORKSPACE_DIR: '/tmp/workspace',
    } as unknown as NodeJS.ProcessEnv)).toBe(true)
    expect(isBoundaryFullModeConfigured({
      OPENCLAW_GATEWAY_HOST: '127.0.0.1',
      OPENCLAW_GATEWAY_PORT: '',
      OPENCLAW_CONFIG_PATH: '/tmp/openclaw.json',
      OPENCLAW_WORKSPACE_DIR: '/tmp/workspace',
    } as unknown as NodeJS.ProcessEnv)).toBe(false)
  })

  it('resolves the current workspace before the legacy desktop harness path', async () => {
    const parentRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-boundary-parent-'))
    const currentRoot = path.join(parentRoot, 'mc-e2e-test')
    const legacyRoot = path.join(parentRoot, 'genesis-harness')
    await mkdir(path.join(currentRoot, 'phase0'), { recursive: true })
    await mkdir(path.join(legacyRoot, 'phase0'), { recursive: true })
    await writeFile(path.join(currentRoot, 'package.json'), '{"name":"current"}\n', 'utf8')
    await writeFile(path.join(legacyRoot, 'package.json'), '{"name":"legacy"}\n', 'utf8')
    const originalCwd = process.cwd()
    try {
      process.env.MC_HARNESS_ROOT = ''
      process.env.GENESIS_HARNESS_ROOT = ''
      process.chdir(currentRoot)
      const { resolveHarnessRoot } = await import('@/lib/harness-boundary')

      await expect(resolveHarnessRoot()).resolves.toBe(await realpath(currentRoot))
    } finally {
      process.chdir(originalCwd)
      await rm(parentRoot, { recursive: true, force: true })
    }
  })

  it('rejects tenant traversal attempts', async () => {
    const { GET, POST } = await loadRoutes()

    const getResponse = await GET(getRequest('../bad'))
    const postResponse = await POST(postRequest({ tenant: '../bad', content: stringifyBoundaryRules(rules()) }))

    expect(getResponse.status).toBe(400)
    expect(postResponse.status).toBe(400)
  })
})
