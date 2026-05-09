import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

const panels = [
  {
    file: 'src/components/panels/hermes-profile-setup-panel.tsx',
    endpoint: '/api/harness/hermes/profile-setup',
    actions: ['check', 'dry-run', 'run'],
    labels: ['Intake', 'SOUL.md', 'Skills', '执行状态'],
  },
  {
    file: 'src/components/panels/hermes-boundary-panel.tsx',
    endpoint: '/api/harness/hermes/boundary',
    actions: ['scan', 'check'],
    labels: ['boundary-rules.json', 'Drift', '扫描结果', '违规记录'],
  },
  {
    file: 'src/components/panels/hermes-skill-curator-panel.tsx',
    endpoint: '/api/harness/hermes/skill-curator',
    actions: ['check', 'approve', 'reject'],
    labels: ['Approved Skills', 'Pending Skills', '版本信息', '审批'],
  },
]

function readPanel(file: string): string {
  return readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('Hermes visual panels H-01 to H-03', () => {
  it.each(panels)('$file is a standalone rich panel', ({ file, endpoint, actions, labels }) => {
    const source = readPanel(file)
    const lineCount = source.split('\n').length

    expect(source).toContain("'use client'")
    expect(source).toContain("useMissionControl")
    expect(source).not.toContain("HermesOperationPanel")
    expect(lineCount).toBeGreaterThanOrEqual(200)
    expect(source).toContain(endpoint)
    expect(source).toContain('rounded-lg border bg-card p-6')
    expect(source).toContain('text-lg font-semibold')
    expect(source).toContain('bg-green-500')
    expect(source).toContain('bg-yellow-500')
    expect(source).toContain('bg-red-500')

    for (const action of actions) {
      expect(source).toContain(action)
    }
    for (const label of labels) {
      expect(source).toContain(label)
    }
  })
})
