import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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

vi.mock('server-only', () => ({}))

describe('GET /api/harness/health', () => {
  const originalEnv = { ...process.env }
  let harnessRoot = ''
  let runnerPath = ''
  let dockerPath = ''

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

  function request(tenant = 'wechat-mp-agent') {
    return new NextRequest(`http://localhost/api/harness/health?tenant=${tenant}`)
  }

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/harness/health/route')
  }

  async function writeRunner(total = 46) {
    await mkdir(path.dirname(runnerPath), { recursive: true })
    await writeFile(runnerPath, `
const cases = [
  ...Array.from({ length: 10 }, (_, index) => ({ suite: 'Golden', testId: 'GOLDEN-CEO-' + String(index + 1).padStart(2, '0'), title: 'Golden ' + index, prompt: 'golden' })),
  ...Array.from({ length: 25 }, (_, index) => ({ suite: 'Adversarial', testId: 'ADV-CEO-' + String(index + 1).padStart(2, '0'), title: 'Adv ' + index, prompt: 'adv' })),
  ...Array.from({ length: 3 }, (_, index) => ({ suite: 'Cross-session', testId: 'CROSS-CEO-' + String(index + 1).padStart(2, '0'), title: 'Cross ' + index, prompt: 'cross' })),
  ...Array.from({ length: ${total === 46 ? 8 : 1} }, (_, index) => ({ suite: 'Drift', testId: 'DFT-TRIG-' + String(index + 1).padStart(2, '0'), title: 'Drift ' + index, prompt: 'drift' })),
]
console.log(JSON.stringify({ tenant: 'wechat-mp-agent', template: 'wechat-mp-agent', total: cases.length, cases }))
`, 'utf8')
  }

  async function writeHarnessFiles() {
    await mkdir(path.join(harnessRoot, 'phase0/templates/wechat-mp-agent/tests'), { recursive: true })
    await mkdir(path.join(harnessRoot, 'phase0/templates/wechat-mp-agent/config'), { recursive: true })
    await writeFile(path.join(harnessRoot, 'package.json'), '{"name":"harness-test"}\n', 'utf8')
    await writeFile(path.join(harnessRoot, 'phase0/templates/wechat-mp-agent/tests/golden-10-cc.md'), '# Golden', 'utf8')
    await writeFile(path.join(harnessRoot, 'phase0/templates/wechat-mp-agent/tests/adversarial-25-cc.md'), '# Adversarial', 'utf8')
    await writeFile(path.join(harnessRoot, 'phase0/templates/wechat-mp-agent/tests/cross-session-3-cc.md'), '# Cross', 'utf8')
    await writeFile(path.join(harnessRoot, 'phase0/templates/wechat-mp-agent/tests/drift-8-cc.md'), '# Drift', 'utf8')
    await writeFile(path.join(harnessRoot, 'phase0/templates/wechat-mp-agent/config/boundary-rules.json'), '{}', 'utf8')
  }

  async function writeFakeDocker(mode: 'healthy' | 'missing' = 'healthy') {
    dockerPath = path.join(harnessRoot, 'fake-docker.mjs')
    await writeFile(dockerPath, `#!/usr/bin/env node
if (${JSON.stringify(mode)} === 'missing') {
  console.error('No such container: wechat-mp-agent')
  process.exit(1)
}
console.log(JSON.stringify([{ State: { Running: true, Health: { Status: 'healthy' } } }]))
`, 'utf8')
    await chmod(dockerPath, 0o755)
  }

  beforeEach(async () => {
    harnessRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-harness-health-'))
    runnerPath = path.join(harnessRoot, 'tools', 'tg-test-runner.ts')
    await writeHarnessFiles()
    await writeRunner()
    await writeFakeDocker()
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: harnessRoot,
      MC_HARNESS_TEST_RUNNER: runnerPath,
      MC_HARNESS_DOCKER_BIN: dockerPath,
    }
    authMock.requireRole.mockReset()
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(harnessRoot, { recursive: true, force: true })
  })

  it('reports ready when harness root, runner, template files, parsed cases, and runtime container are healthy', async () => {
    authMock.requireRole.mockReturnValue({ user: user('viewer') })
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'viewer')
    expect(body.status).toBe('ready')
    expect(body.tenant).toBe('wechat-mp-agent')
    expect(body.template).toBe('wechat-mp-agent')
    expect(body.total_cases).toBe(46)
    expect(body.runtime_target).toBe('docker exec wechat-mp-agent')
    expect(body.container).toMatchObject({
      name: 'wechat-mp-agent',
      status: 'pass',
      running: true,
      health: 'healthy',
    })
    expect(body.suites.find((suite: any) => suite.id === 'golden')).toMatchObject({
      expected: 10,
      actual: 10,
      status: 'pass',
    })
    expect(body.checks.find((check: any) => check.id === 'runner_parse')).toMatchObject({
      status: 'pass',
    })
    expect(body.checks.find((check: any) => check.id === 'runtime_container')).toMatchObject({
      status: 'pass',
    })
  })

  it('blocks P10 when the harness runtime tenant container is missing', async () => {
    await writeFakeDocker('missing')
    process.env.MC_HARNESS_DOCKER_BIN = dockerPath
    authMock.requireRole.mockReturnValue({ user: user('viewer') })
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('blocked')
    expect(body.runtime_target).toBe('docker exec wechat-mp-agent')
    expect(body.container).toMatchObject({
      name: 'wechat-mp-agent',
      status: 'fail',
      running: false,
      health: null,
    })
    expect(body.container.detail).toContain('No such container: wechat-mp-agent')
    expect(body.checks.find((check: any) => check.id === 'runtime_container')).toMatchObject({
      status: 'fail',
    })
    expect(body.suites.find((suite: any) => suite.id === 'drift')).toMatchObject({
      actual: 8,
      status: 'pass',
    })
  })
})
