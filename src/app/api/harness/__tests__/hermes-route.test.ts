import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

const hermesTasksMock = vi.hoisted(() => ({
  getHermesTasks: vi.fn(),
}))

const commandMock = vi.hoisted(() => ({
  runCommand: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/command', () => commandMock)

vi.mock('@/lib/hermes-tasks', () => ({
  getHermesTasks: hermesTasksMock.getHermesTasks,
}))

describe('GET /api/harness/hermes', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''
  let vaultRoot = ''
  let hermesHome = ''

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

  async function loadGet() {
    vi.resetModules()
    const route = await import('@/app/api/harness/hermes/route')
    return route.GET
  }

  async function loadPost() {
    vi.resetModules()
    const route = await import('@/app/api/harness/hermes/route')
    return route.POST
  }

  function request(cookie?: string, query = '') {
    return new NextRequest(`http://localhost/api/harness/hermes${query}`, {
      headers: cookie ? { cookie } : {},
    })
  }

  function postRequest(body: unknown, cookie?: string) {
    return new NextRequest('http://localhost/api/harness/hermes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mc-hermes-route-'))
    vaultRoot = path.join(tempDir, 'openclaw-vault')
    hermesHome = path.join(tempDir, 'hermes-home')
    await mkdir(path.join(vaultRoot, 'Agent-Shared'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'Agent-Main'), { recursive: true })
    await mkdir(hermesHome, { recursive: true })
    await writeFile(path.join(vaultRoot, 'Agent-Shared/hermes-log.md'), '# Hermes Guard Log\n', 'utf8')
    await writeFile(path.join(vaultRoot, 'Agent-Main/working-context.md'), '# fresh\n', 'utf8')
    await writeFile(path.join(hermesHome, 'SOUL.md'), '# Hermes SOUL\n', 'utf8')
    await writeFile(path.join(hermesHome, 'AGENTS.md'), '# Hermes Agents\n', 'utf8')
    await writeFile(path.join(hermesHome, 'config.yaml'), [
      'model:',
      '  provider: openai-codex',
      '  default: gpt-5.4',
      '  base_url: https://chatgpt.com/backend-api/codex',
      'toolsets:',
      '  - hermes-cli',
      'agent:',
      '  max_turns: 90',
      '  gateway_timeout: 1800',
      'terminal:',
      '  backend: local',
      '  cwd: .',
      'browser:',
      '  allow_private_urls: false',
      '',
    ].join('\n'), 'utf8')

    process.env = {
      ...originalEnv,
      MC_OBSIDIAN_VAULT_ROOT: vaultRoot,
      HERMES_DAEMON_PID_FILE: path.join(vaultRoot, 'Agent-Shared/hermes-daemon.pid'),
      HERMES_LOG_FILE: path.join(vaultRoot, 'Agent-Shared/hermes-log.md'),
      HERMES_HOME: hermesHome,
    }
    authMock.requireRole.mockReset()
    hermesTasksMock.getHermesTasks.mockReset()
    hermesTasksMock.getHermesTasks.mockReturnValue({ cronJobs: [] })
    commandMock.runCommand.mockReset()
    commandMock.runCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('allows admin users to read Hermes state', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    const GET = await loadGet()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'operator')
    expect(body.daemon_running).toBe(false)
    expect(body.targets[0].health).toBe('fresh')
    expect(body.cron).toMatchObject({
      total_jobs: 0,
      enabled_jobs: 0,
      openclaw_monitoring: false,
      heartbeat_monitoring: false,
    })
    expect(body.cron.evidence).toContain('No Hermes cron jobs found')
    expect(body.config).toMatchObject({
      config_exists: true,
      provider: 'openai-codex',
      model: 'gpt-5.4',
      base_url: 'https://chatgpt.com/backend-api/codex',
      toolsets: ['hermes-cli'],
      max_turns: 90,
      gateway_timeout: 1800,
      terminal_backend: 'local',
      terminal_cwd: '.',
      browser_private_urls: false,
      soul_exists: true,
      agents_exists: true,
      cron_jobs_exists: false,
      cron_allowlist_exists: false,
    })
    expect(body.config.config_path).toBe(path.join(hermesHome, 'config.yaml'))
    expect(body.config.cron_jobs_path).toBe(path.join(hermesHome, 'cron/jobs.json'))
    expect(body.config.cron_allowlist_path).toBe(path.join(hermesHome, 'cron/allowlist.yaml'))
    expect(body.setup).toMatchObject({
      ready: false,
      status: 'blocked',
      ready_steps: 3,
      warning_steps: 0,
      blocking_steps: 2,
      total_steps: 5,
    })
    expect(body.setup.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'config-yaml', status: 'ready' }),
      expect.objectContaining({ id: 'soul-md', status: 'ready' }),
      expect.objectContaining({ id: 'agents-md', status: 'ready' }),
      expect.objectContaining({ id: 'cron-jobs', status: 'missing' }),
      expect.objectContaining({ id: 'cron-allowlist', status: 'missing' }),
    ]))
  })

  it('reports Hermes cron evidence when OpenClaw heartbeat monitoring jobs exist', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    await mkdir(path.join(hermesHome, 'cron'), { recursive: true })
    await writeFile(path.join(hermesHome, 'cron/jobs.json'), '[]\n', 'utf8')
    await writeFile(path.join(hermesHome, 'cron/allowlist.yaml'), 'allowed_jobs:\n  - openclaw-heartbeat\n', 'utf8')
    hermesTasksMock.getHermesTasks.mockReturnValue({
      cronJobs: [
        {
          id: 'openclaw-heartbeat',
          name: 'OpenClaw Heartbeat Monitor',
          prompt: 'Check OpenClaw tenant heartbeat and working-context freshness',
          schedule: '*/15 * * * *',
          enabled: true,
          lastRunAt: '2026-05-01T10:00:00Z',
          lastOutput: 'ok',
          createdAt: '2026-05-01T09:00:00Z',
          runCount: 3,
        },
      ],
    })
    const GET = await loadGet()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(hermesTasksMock.getHermesTasks).toHaveBeenCalledWith(true)
    expect(body.cron).toMatchObject({
      total_jobs: 1,
      enabled_jobs: 1,
      openclaw_monitoring: true,
      heartbeat_monitoring: true,
      last_run_at: '2026-05-01T10:00:00Z',
    })
    expect(body.cron.jobs[0]).toMatchObject({
      id: 'openclaw-heartbeat',
      name: 'OpenClaw Heartbeat Monitor',
      schedule: '*/15 * * * *',
      enabled: true,
      runCount: 3,
    })
    expect(body.setup).toMatchObject({
      ready: true,
      status: 'ready',
      ready_steps: 5,
      warning_steps: 0,
      blocking_steps: 0,
    })
  })

  it('filters monitoring targets to the URL tenant and reports concrete critical detail', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    await mkdir(path.join(vaultRoot, 'Agent-Kid'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'Agent-Kid/working-context.md'), '# kid\n', 'utf8')
    await writeFile(path.join(vaultRoot, 'Agent-Shared/hermes-log.md'), [
      '# Hermes Guard Log',
      '- 2026-05-05T10:00:00Z | Agent-Main | ALERT | 卡死告警: stale',
      '- 2026-05-05T10:00:00Z | Agent-Kid | ALERT | 卡死告警: stale',
      '',
    ].join('\n'), 'utf8')
    const dockerError = Object.assign(new Error('No such container: ceo-assistant-v1'), {
      stderr: 'No such container: ceo-assistant-v1',
      code: 1,
    })
    commandMock.runCommand.mockRejectedValue(dockerError)
    const GET = await loadGet()

    const response = await GET(request(undefined, '?tenant=ceo-assistant-v1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.tenant_filter).toBe('ceo-assistant-v1')
    expect(body.targets).toHaveLength(1)
    expect(body.targets[0]).toMatchObject({
      agent_dir: 'Agent-Main',
      severity: 'critical',
    })
    expect(body.targets[0].reason).toContain('container not found')
    expect(body.repair_history.map((item: { target_agent: string }) => item.target_agent)).toEqual(['Agent-Main'])
  })

  it('returns repair history parsed from inspection log and alerts jsonl', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    await writeFile(path.join(vaultRoot, 'Agent-Shared/hermes-log.md'), [
      '# Hermes Guard Log',
      '- 2026-05-05T10:00:00Z | Agent-Main | ALERT | 卡死告警: working-context.md 720000s 未更新，超过 21600s 阈值',
      '- 2026-05-05T10:01:00Z | Agent-Main | FIX | restart container | success',
      '- 2026-05-05T10:02:00Z | Agent-Main | CLEANUP | stale record cleaned | success',
      '',
    ].join('\n'), 'utf8')
    await writeFile(
      path.join(vaultRoot, 'Agent-Shared/hermes-alerts.jsonl'),
      `${JSON.stringify({ ts: '2026-05-05T10:03:00Z', agent: 'Agent-Main', message: '卡死告警: stale' })}\n`,
      'utf8',
    )
    const GET = await loadGet()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.repair_history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action_type: 'send_alert',
        target_agent: 'Agent-Main',
        result: 'success',
      }),
      expect.objectContaining({
        action_type: 'restart_container',
        target_agent: 'Agent-Main',
        result: 'success',
      }),
      expect.objectContaining({
        action_type: 'cleanup_stale',
        target_agent: 'Agent-Main',
        result: 'success',
      }),
    ]))
  })

  it('allows operator users to read Hermes state', async () => {
    authMock.requireRole.mockReturnValue({ user: user('operator') })
    const GET = await loadGet()

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'operator')
  })

  it('registers the Mission Control Hermes cron monitor without overwriting existing jobs', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    await mkdir(path.join(hermesHome, 'cron'), { recursive: true })
    await writeFile(path.join(hermesHome, 'cron/jobs.json'), JSON.stringify([
      {
        id: 'existing-job',
        prompt: 'Existing job',
        schedule: '0 9 * * *',
        enabled: true,
      },
    ]), 'utf8')
    const POST = await loadPost()

    const response = await POST(postRequest({ action: 'register-cron' }))
    const body = await response.json()
    const raw = await readFile(path.join(hermesHome, 'cron/jobs.json'), 'utf8')
    const jobs = JSON.parse(raw)

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'existing-job' }),
      expect.objectContaining({
        id: 'mission-control-openclaw-heartbeat',
        schedule: '*/30 * * * *',
        enabled: true,
      }),
    ]))
    expect(jobs).toHaveLength(2)
    const allowlist = await readFile(path.join(hermesHome, 'cron/allowlist.yaml'), 'utf8')
    expect(allowlist).toContain('allowed_jobs:')
    expect(allowlist).toContain('mission-control-openclaw-heartbeat')
  })

  it('lets setup save, toggle, and remove Hermes cron jobs', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    await mkdir(path.join(hermesHome, 'cron'), { recursive: true })
    await writeFile(path.join(hermesHome, 'cron/jobs.json'), JSON.stringify({ version: 1, jobs: [] }), 'utf8')
    const POST = await loadPost()

    const saveResponse = await POST(postRequest({
      action: 'save-cron-job',
      id: 'custom-openclaw-monitor',
      name: 'Custom OpenClaw monitor',
      schedule: '*/10 * * * *',
      prompt: 'Check OpenClaw heartbeat freshness and working-context files.',
      enabled: true,
    }))
    expect(saveResponse.status).toBe(200)

    const toggleResponse = await POST(postRequest({
      action: 'toggle-cron-job',
      id: 'custom-openclaw-monitor',
      enabled: false,
    }))
    expect(toggleResponse.status).toBe(200)

    let raw = await readFile(path.join(hermesHome, 'cron/jobs.json'), 'utf8')
    let parsed = JSON.parse(raw)
    expect(parsed).toMatchObject({
      version: 1,
      jobs: [
        expect.objectContaining({
          id: 'custom-openclaw-monitor',
          name: 'Custom OpenClaw monitor',
          schedule: '*/10 * * * *',
          enabled: false,
        }),
      ],
    })

    const removeResponse = await POST(postRequest({
      action: 'remove-cron-job',
      id: 'custom-openclaw-monitor',
    }))
    expect(removeResponse.status).toBe(200)

    raw = await readFile(path.join(hermesHome, 'cron/jobs.json'), 'utf8')
    parsed = JSON.parse(raw)
    expect(parsed.jobs).toEqual([])
  })

  it('keeps unrelated jobs when their names collide with the default monitor name', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    await mkdir(path.join(hermesHome, 'cron'), { recursive: true })
    await writeFile(path.join(hermesHome, 'cron/jobs.json'), JSON.stringify({
      version: 1,
      jobs: [
        {
          id: 'custom-job',
          name: 'Mission Control OpenClaw heartbeat monitor',
          schedule: '5 * * * *',
          prompt: 'Custom job that happens to share the display name',
          enabled: true,
        },
      ],
    }), 'utf8')
    const POST = await loadPost()

    const response = await POST(postRequest({ action: 'register-cron' }))
    const body = await response.json()
    const raw = await readFile(path.join(hermesHome, 'cron/jobs.json'), 'utf8')
    const parsed = JSON.parse(raw)

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(parsed.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-job', name: 'Mission Control OpenClaw heartbeat monitor' }),
      expect.objectContaining({ id: 'mission-control-openclaw-heartbeat' }),
    ]))
    expect(parsed.jobs).toHaveLength(2)
  })

  it('targets cron jobs by id instead of matching other jobs by display name', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    await mkdir(path.join(hermesHome, 'cron'), { recursive: true })
    await writeFile(path.join(hermesHome, 'cron/jobs.json'), JSON.stringify({
      version: 1,
      jobs: [
        {
          id: 'job-a',
          name: 'job-b',
          schedule: '0 * * * *',
          prompt: 'Display name collides with another job id',
          enabled: true,
        },
        {
          id: 'job-b',
          name: 'Real job b',
          schedule: '*/10 * * * *',
          prompt: 'Actual target job',
          enabled: true,
        },
      ],
    }), 'utf8')
    const POST = await loadPost()

    const toggleResponse = await POST(postRequest({
      action: 'toggle-cron-job',
      id: 'job-b',
      enabled: false,
    }))
    expect(toggleResponse.status).toBe(200)

    let raw = await readFile(path.join(hermesHome, 'cron/jobs.json'), 'utf8')
    let parsed = JSON.parse(raw)
    expect(parsed.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job-a', enabled: true }),
      expect.objectContaining({ id: 'job-b', enabled: false }),
    ]))

    const removeResponse = await POST(postRequest({
      action: 'remove-cron-job',
      id: 'job-b',
    }))
    expect(removeResponse.status).toBe(200)

    raw = await readFile(path.join(hermesHome, 'cron/jobs.json'), 'utf8')
    parsed = JSON.parse(raw)
    expect(parsed.jobs).toEqual([
      expect.objectContaining({ id: 'job-a', name: 'job-b' }),
    ])
  })

  it('starts the guard daemon and runs an immediate inspection before returning state', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    commandMock.runCommand.mockImplementation(async (_command: string, args: string[]) => {
      if (args.includes('check')) {
        await appendFile(path.join(vaultRoot, 'Agent-Shared/hermes-log.md'), [
          '## 2026-05-05T12:34:56Z first heartbeat',
          '- 2026-05-05T12:34:56Z | Agent-Main | OK | heartbeat_age=2s',
          '',
        ].join('\n'), 'utf8')
      }
      return { stdout: '', stderr: '', code: 0 }
    })
    const POST = await loadPost()

    const response = await POST(postRequest({ action: 'start' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(commandMock.runCommand).toHaveBeenCalledTimes(2)
    expect(commandMock.runCommand.mock.calls[0][1]).toEqual([expect.stringContaining('hermes-daemon.sh'), 'start'])
    expect(commandMock.runCommand.mock.calls[1][1]).toEqual([expect.stringContaining('hermes-daemon.sh'), 'check'])
    expect(body.state.inspection.last_run_at).toBe('2026-05-05T12:34:56Z')
  })

  it('blocks customer view role even when authenticated', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    const GET = await loadGet()

    const response = await GET(request('mc-view-role=customer'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Customer role cannot access Hermes internals')
  })

  it('returns 401 when requireRole cannot authenticate the request', async () => {
    authMock.requireRole.mockReturnValue({ error: 'Authentication required', status: 401 })
    const GET = await loadGet()

    const response = await GET(request())

    expect(response.status).toBe(401)
  })
})
