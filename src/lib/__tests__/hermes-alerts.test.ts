import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  discoverHermesAlertFiles,
  getAggregatedHermesAlerts,
  parseHermesAlertLine,
  readHermesAlertFile,
  type HermesAlertFile,
} from '@/lib/hermes-alerts'

describe('hermes-alerts', () => {
  const originalEnv = { ...process.env }
  let tempRoot = ''
  let vaultRoot = ''

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-hermes-alerts-'))
    vaultRoot = path.join(tempRoot, 'vault')
    await mkdir(path.join(tempRoot, 'phase0', 'tenants'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'Agent-Shared'), { recursive: true })
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: tempRoot,
      MC_OBSIDIAN_VAULT_ROOT: vaultRoot,
      HERMES_LOG_FILE: '',
    }
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('parses Hermes ALERT markdown lines with severity and jump target', () => {
    const file: HermesAlertFile = {
      path: '/tmp/hermes-log.md',
      tenant: null,
      source_label: 'Hermes vault',
    }

    const alert = parseHermesAlertLine(
      '- 2026-04-27T13:02:56Z | Agent-Main | ALERT | 卡死告警: working-context.md 35236s 未更新，超过 21600s 阈值',
      file,
      1,
    )

    expect(alert).toMatchObject({
      severity: 'high',
      title: '卡死告警',
      source: 'hermes',
      source_type: 'hermes-alert',
      source_label: 'Hermes vault',
      agent: 'Agent-Main',
      acknowledged: false,
      jump_href: '/hermes',
    })
    expect(alert?.message).toContain('working-context.md')
  })

  it('discovers tenant and vault Hermes alert files', async () => {
    await mkdir(path.join(tempRoot, 'phase0/tenants/tenant-demo'), { recursive: true })
    await writeFile(path.join(tempRoot, 'phase0/tenants/tenant-demo/hermes-log.md'), '# tenant\n', 'utf8')
    await writeFile(path.join(vaultRoot, 'Agent-Shared/hermes-log.md'), '# vault\n', 'utf8')

    const files = await discoverHermesAlertFiles({ tenant: 'tenant-demo' })

    expect(files.map(file => file.path).sort()).toEqual([
      path.join(tempRoot, 'phase0/tenants/tenant-demo/hermes-log.md'),
      path.join(vaultRoot, 'Agent-Shared/hermes-log.md'),
    ].sort())
  })

  it('merges multiple Hermes sources newest first', async () => {
    await mkdir(path.join(tempRoot, 'phase0/tenants/tenant-demo'), { recursive: true })
    await writeFile(
      path.join(tempRoot, 'phase0/tenants/tenant-demo/hermes-log.md'),
      '- 2026-04-27T10:00:00Z | Agent-Main | ALERT | 卡死告警: stale\n',
      'utf8',
    )
    await writeFile(
      path.join(vaultRoot, 'Agent-Shared/hermes-log.md'),
      '- 2026-04-27T11:00:00Z | Agent-Hermes | ALERT | 卡死告警: stale\n',
      'utf8',
    )

    const alerts = await getAggregatedHermesAlerts({ tenant: 'tenant-demo' })

    expect(alerts).toHaveLength(2)
    expect(alerts.map(alert => alert.agent)).toEqual(['Agent-Hermes', 'Agent-Main'])
  })

  it('returns empty arrays when files are missing', async () => {
    const alerts = await readHermesAlertFile({ path: path.join(tempRoot, 'missing.md'), tenant: null, source_label: 'missing' })

    expect(alerts).toEqual([])
    await expect(getAggregatedHermesAlerts({ tenant: 'tenant-empty' })).resolves.toEqual([])
  })

  it('rejects tenant traversal', async () => {
    await expect(discoverHermesAlertFiles({ tenant: '../secret' })).rejects.toThrow('Invalid tenant')
  })
})
