import { describe, expect, it } from 'vitest'
import {
  buildHermesCommand,
  getHermesPanelConfig,
  parseHermesJsonOutput,
} from '@/lib/hermes-harness'

describe('Hermes harness panel helpers', () => {
  it('maps profile setup to H-01 and the profile setup script', () => {
    const config = getHermesPanelConfig('profile')

    expect(config.stage).toBe('H-01')
    expect(config.script).toBe('profile-setup.js')
    expect(config.endpoint).toBe('/api/harness/hermes/profile-setup')
  })

  it('builds memory isolation check commands with tenant scope', () => {
    const command = buildHermesCommand('memory', {
      action: 'check-isolation',
      memoriesDir: 'tenants/tenant-test-001/memory/memories',
      configPath: 'tenants/tenant-test-001/memory/memory-config.json',
      tenantId: 'tenant-test-001',
    })

    expect(command.script).toContain('memory-curator.js')
    expect(command.args).toContain('--check-isolation')
    expect(command.args).toContain('--tenant-id')
    expect(command.args).toContain('tenant-test-001')
  })

  it('builds guardian token budget record commands', () => {
    const command = buildHermesCommand('guardian', {
      module: 'token-budget',
      action: 'record',
      budgetFile: 'tenants/tenant-test-001/budget.json',
      usageLog: 'tenants/tenant-test-001/logs/token-usage.jsonl',
      tokens: 1500,
      model: 'claude-sonnet-4-20250514',
    })

    expect(command.script).toContain('token-budget.js')
    expect(command.args).toEqual([
      command.script,
      '--budget-file',
      'tenants/tenant-test-001/budget.json',
      '--usage-log',
      'tenants/tenant-test-001/logs/token-usage.jsonl',
      '--record',
      '--tokens',
      '1500',
      '--model',
      'claude-sonnet-4-20250514',
    ])
  })

  it('parses json output and preserves non-json output', () => {
    expect(parseHermesJsonOutput('{"status":"healthy"}')).toEqual({ status: 'healthy' })
    expect(parseHermesJsonOutput('plain text')).toEqual({ raw: 'plain text' })
  })
})
