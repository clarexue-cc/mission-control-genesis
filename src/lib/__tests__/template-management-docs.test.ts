import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../..')

describe('template management runbook', () => {
  const runbook = readFileSync(resolve(ROOT, 'docs/runbooks/template-management.md'), 'utf8')
  const claude = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf8')

  it('documents the source directory and placeholder contract', () => {
    expect(runbook).toContain('phase0/templates/vault-template/')
    for (const placeholder of [
      'TENANT_ID',
      'TENANT_NAME',
      'ROLE',
      'DELIVERY_MODE',
      'AGENT_NAME',
      'TONE',
      'FORBIDDEN_RULES',
      'BOUNDARY_RULES',
      'UAT_CRITERIA',
      'SKILL_LIST',
      'GENERATED_AT',
    ]) {
      expect(runbook).toContain(`{{${placeholder}}}`)
    }
  })

  it('documents governance rules and links from CLAUDE.md', () => {
    expect(runbook).toContain('PR review')
    expect(runbook).toContain('大管家')
    expect(runbook).toContain('已 tenant 不自动迁移')
    expect(runbook).toContain('Phase 1b')
    expect(runbook).toContain('customer-type variant')
    expect(claude).toContain('docs/runbooks/template-management.md')
  })
})
