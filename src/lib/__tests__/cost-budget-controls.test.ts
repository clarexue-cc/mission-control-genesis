import { describe, expect, it } from 'vitest'
import {
  normalizeCostBudgetRuleInput,
  summarizeCostBudgetRules,
  type CostBudgetRule,
} from '@/lib/cost-budget-controls'

describe('cost budget controls', () => {
  it('summarizes agent and task limits across API and LLM costs', () => {
    const rules: CostBudgetRule[] = [
      {
        id: 'agent-newsroom-llm',
        scope: 'agent',
        target: 'newsroom-researcher',
        category: 'llm',
        timeframe: 'day',
        limitUsd: 8,
        maxRequests: null,
        maxTokens: 200000,
        action: 'require_approval',
        enabled: true,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
      {
        id: 'task-42-api',
        scope: 'task',
        target: '42',
        category: 'api',
        timeframe: 'run',
        limitUsd: 2.5,
        maxRequests: 100,
        maxTokens: null,
        action: 'warn',
        enabled: true,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    ]

    expect(summarizeCostBudgetRules(rules)).toMatchObject({
      totalRules: 2,
      enabledRules: 2,
      byScope: { agent: 1, task: 1 },
      byCategory: { api: 1, llm: 1, total: 0 },
      highestLimitUsd: 8,
      blockingRules: 1,
    })
  })

  it('normalizes editable budget inputs and requires at least one cap', () => {
    const normalized = normalizeCostBudgetRuleInput({
      scope: 'agent',
      target: 'analyst',
      category: 'total',
      timeframe: 'week',
      limitUsd: '12.50',
      maxRequests: '300',
      maxTokens: '',
      action: 'pause',
    }, new Date('2026-05-01T00:00:00Z'))

    expect(normalized).toMatchObject({
      scope: 'agent',
      target: 'analyst',
      category: 'total',
      timeframe: 'week',
      limitUsd: 12.5,
      maxRequests: 300,
      maxTokens: null,
      action: 'pause',
      enabled: true,
    })
    expect(normalized.id).toBe('agent-total-analyst-week')

    expect(() => normalizeCostBudgetRuleInput({
      scope: 'task',
      target: '77',
      category: 'llm',
      timeframe: 'day',
      action: 'warn',
    })).toThrow('At least one cost, request, or token cap is required')
  })
})
