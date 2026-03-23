import { describe, expect, it } from 'vitest'

import { OPERATION_SCHEDULES } from '@/lib/agent-identity'

describe('operation schedules', () => {
  it('uses neutral example data by default', () => {
    const serialized = JSON.stringify(OPERATION_SCHEDULES)

    const disallowed = [
      'Ali engineering',
      'Intelligence Council',
      'Gmail drafts',
      'ClickUp',
      'Granola',
      'Perplexity Computer',
    ]

    for (const token of disallowed) {
      expect(serialized).not.toContain(token)
    }
  })

  it('contains at least one schedule row for each primary source group', () => {
    const sources = new Set(OPERATION_SCHEDULES.map(row => row.source))

    expect(sources.has('external')).toBe(true)
    expect(sources.has('openclaw')).toBe(true)
    expect(sources.has('jarvisv2')).toBe(true)
  })
})
