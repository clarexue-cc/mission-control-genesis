import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getHermesTasks', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''

  afterEach(async () => {
    process.env = { ...originalEnv }
    vi.resetModules()
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('reads cron jobs from HERMES_CRON_JOBS_FILE and preserves custom names', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mc-hermes-tasks-'))
    const cronDir = path.join(tempDir, 'custom-cron')
    const jobsFile = path.join(cronDir, 'jobs.json')
    await mkdir(cronDir, { recursive: true })
    await writeFile(jobsFile, JSON.stringify({
      version: 1,
      jobs: [
        {
          id: 'custom-openclaw-monitor',
          name: 'Custom OpenClaw Monitor',
          schedule: '*/10 * * * *',
          prompt: 'Check OpenClaw heartbeat freshness and working-context files.',
          enabled: true,
        },
      ],
    }), 'utf8')

    process.env = {
      ...originalEnv,
      HERMES_CRON_JOBS_FILE: jobsFile,
      HERMES_HOME: path.join(tempDir, 'ignored-hermes-home'),
    }

    const { getHermesTasks } = await import('@/lib/hermes-tasks')
    const result = getHermesTasks(true)

    expect(result.cronJobs).toEqual([
      expect.objectContaining({
        id: 'custom-openclaw-monitor',
        name: 'Custom OpenClaw Monitor',
        schedule: '*/10 * * * *',
        enabled: true,
      }),
    ])
  })
})