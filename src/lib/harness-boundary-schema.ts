import { z } from 'zod'

const requiredText = z.string().trim().min(1, 'Required')

export const forbiddenRuleSchema = z.object({
  id: requiredText,
  category: requiredText,
  patterns: z.array(z.string()).default([]),
  pattern: requiredText,
  label: requiredText,
  severity: requiredText,
  action: requiredText,
  response_template: requiredText,
}).passthrough()

export const driftRuleSchema = z.object({
  id: requiredText,
  category: requiredText,
  pattern: requiredText,
}).passthrough()

export const boundaryRulesSchema = z.object({
  version: requiredText,
  last_updated: requiredText,
  forbidden_patterns: z.array(forbiddenRuleSchema).default([]),
  drift_patterns: z.array(driftRuleSchema).default([]),
}).passthrough()

export type ForbiddenRule = z.infer<typeof forbiddenRuleSchema>
export type DriftRule = z.infer<typeof driftRuleSchema>
export type BoundaryRules = z.infer<typeof boundaryRulesSchema>

function compileRegex(pattern: string, label: string) {
  try {
    new RegExp(pattern, 'u')
  } catch (error: any) {
    throw new Error(`${label}: ${error?.message || 'Invalid regular expression'}`)
  }
}

export function validateBoundaryRules(value: unknown): BoundaryRules {
  const parsed = boundaryRulesSchema.parse(value)
  parsed.forbidden_patterns.forEach((rule, index) => {
    compileRegex(rule.pattern, `forbidden_patterns[${index}].pattern`)
  })
  parsed.drift_patterns.forEach((rule, index) => {
    compileRegex(rule.pattern, `drift_patterns[${index}].pattern`)
  })
  return parsed
}

export function parseBoundaryRulesRaw(raw: string): BoundaryRules {
  try {
    return validateBoundaryRules(JSON.parse(raw))
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON: ${error.message}`)
    }
    throw error
  }
}

export function stringifyBoundaryRules(rules: BoundaryRules): string {
  return `${JSON.stringify(rules, null, 2)}\n`
}

export function createEmptyBoundaryRules(): BoundaryRules {
  return {
    version: '2.0',
    last_updated: new Date().toISOString().slice(0, 10),
    forbidden_patterns: [],
    drift_patterns: [],
  }
}

export function createBlankForbiddenRule(): ForbiddenRule {
  return {
    id: `forbidden_${Date.now()}`,
    category: 'custom',
    patterns: ['example trigger'],
    pattern: 'example trigger',
    label: 'Custom boundary rule',
    severity: 'medium',
    action: 'block',
    response_template: 'This request is blocked by the current boundary rules.',
  }
}

export function createBlankDriftRule(): DriftRule {
  return {
    id: `drift_${Date.now()}`,
    category: 'custom',
    pattern: 'example drift trigger',
  }
}
