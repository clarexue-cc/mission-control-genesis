export type CostBudgetScope = 'agent' | 'task'
export type CostBudgetCategory = 'api' | 'llm' | 'total'
export type CostBudgetTimeframe = 'day' | 'week' | 'month' | 'run'
export type CostBudgetAction = 'warn' | 'require_approval' | 'pause'

export interface CostBudgetRule {
  id: string
  scope: CostBudgetScope
  target: string
  category: CostBudgetCategory
  timeframe: CostBudgetTimeframe
  limitUsd: number | null
  maxRequests: number | null
  maxTokens: number | null
  action: CostBudgetAction
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface CostBudgetSummary {
  totalRules: number
  enabledRules: number
  byScope: Record<CostBudgetScope, number>
  byCategory: Record<CostBudgetCategory, number>
  highestLimitUsd: number | null
  blockingRules: number
}

const SCOPES: CostBudgetScope[] = ['agent', 'task']
const CATEGORIES: CostBudgetCategory[] = ['api', 'llm', 'total']
const TIMEFRAMES: CostBudgetTimeframe[] = ['day', 'week', 'month', 'run']
const ACTIONS: CostBudgetAction[] = ['warn', 'require_approval', 'pause']

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'target'
}

export function normalizeCostBudgetRuleInput(input: Record<string, unknown>, now = new Date()): CostBudgetRule {
  const scope = asEnum(input.scope, SCOPES, 'agent')
  const category = asEnum(input.category, CATEGORIES, 'total')
  const timeframe = asEnum(input.timeframe, TIMEFRAMES, 'day')
  const action = asEnum(input.action, ACTIONS, 'require_approval')
  const target = String(input.target ?? '').trim()
  if (!target) throw new Error('Budget target is required')

  const limitUsd = parseNullableNumber(input.limitUsd)
  const maxRequests = parseNullableNumber(input.maxRequests)
  const maxTokens = parseNullableNumber(input.maxTokens)
  if (limitUsd === null && maxRequests === null && maxTokens === null) {
    throw new Error('At least one cost, request, or token cap is required')
  }

  const updatedAt = now.toISOString()
  const id = String(input.id || `${scope}-${category}-${slugify(target)}-${timeframe}`)
  return {
    id,
    scope,
    target,
    category,
    timeframe,
    limitUsd,
    maxRequests,
    maxTokens,
    action,
    enabled: input.enabled !== false,
    createdAt: typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : updatedAt,
    updatedAt,
  }
}

export function summarizeCostBudgetRules(rules: CostBudgetRule[]): CostBudgetSummary {
  const enabledRules = rules.filter(rule => rule.enabled)
  const limitValues = enabledRules
    .map(rule => rule.limitUsd)
    .filter((limit): limit is number => typeof limit === 'number' && Number.isFinite(limit))

  return {
    totalRules: rules.length,
    enabledRules: enabledRules.length,
    byScope: {
      agent: enabledRules.filter(rule => rule.scope === 'agent').length,
      task: enabledRules.filter(rule => rule.scope === 'task').length,
    },
    byCategory: {
      api: enabledRules.filter(rule => rule.category === 'api').length,
      llm: enabledRules.filter(rule => rule.category === 'llm').length,
      total: enabledRules.filter(rule => rule.category === 'total').length,
    },
    highestLimitUsd: limitValues.length ? Math.max(...limitValues) : null,
    blockingRules: enabledRules.filter(rule => rule.action !== 'warn').length,
  }
}
