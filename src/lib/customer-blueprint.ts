import type {
  CustomerAnalysisDraft,
  CustomerAnalysisMode,
  CustomerAnalysisState,
  CustomerSkillCandidate,
  CustomerWorkflowStep,
} from '@/lib/customer-analysis'
import type { BoundaryRules, ForbiddenRule } from '@/lib/harness-boundary-schema'

export interface CustomerUatDraftTask {
  id: string
  order: number
  tenant_id: string
  title: string
  description: string
  acceptance_criteria: string[]
  source: 'p4-blueprint'
}

export interface CustomerBlueprintPayload {
  tenant_id: string
  intake_raw_hash: string
  analysis_path: string
  analysis_exists: boolean
  analysis_matches_intake: boolean
  mode: CustomerAnalysisMode | null
  workflow_steps: CustomerWorkflowStep[]
  delivery_mode: CustomerAnalysisDraft['delivery_mode']
  delivery_mode_reason: string
  skills_blueprint: CustomerSkillCandidate[]
  skill_candidates: CustomerSkillCandidate[]
  boundary_rules: BoundaryRules
  boundary_draft: string[]
  uat_tasks: CustomerUatDraftTask[]
  uat_criteria: string[]
  soul_draft: CustomerAnalysisDraft['soul_draft']
}

function cleanText(value: string, maxLength = 400): string {
  return value.replace(/[\0\r]/g, '').trim().slice(0, maxLength)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function summarizeTitle(value: string, fallback: string): string {
  const cleaned = cleanText(value, 120)
  if (!cleaned) return fallback
  const split = cleaned.split(/[。.!?！？；;]/).map(part => part.trim()).filter(Boolean)
  return split[0] || cleaned
}

function boundaryRuleFromDraft(tenantId: string, rule: string, index: number): ForbiddenRule {
  const label = summarizeTitle(rule, `P4 boundary ${index + 1}`)
  return {
    id: `p4-boundary-${index + 1}`,
    category: `customer-${tenantId}`,
    patterns: [cleanText(rule, 240)],
    pattern: escapeRegExp(cleanText(rule, 240)),
    label,
    severity: index < 2 ? 'high' : 'medium',
    action: 'block',
    response_template: `This request is blocked by the ${tenantId} P4 boundary draft: ${label}`,
  }
}

export function buildCustomerBoundaryRulesDraft(input: {
  tenantId: string
  draft: CustomerAnalysisDraft
  generatedAt?: Date
}): BoundaryRules {
  return {
    version: '1.0',
    last_updated: (input.generatedAt || new Date()).toISOString().slice(0, 10),
    forbidden_patterns: input.draft.boundary_draft.map((rule, index) => boundaryRuleFromDraft(input.tenantId, rule, index)),
    drift_patterns: [],
    metadata: {
      source: 'p4-blueprint',
      tenant_id: input.tenantId,
      delivery_mode: input.draft.delivery_mode,
    },
  }
}

export function buildCustomerSkillsBlueprint(draft: CustomerAnalysisDraft): CustomerSkillCandidate[] {
  return [...draft.skill_candidates].sort((left, right) => left.order - right.order)
}

export function buildCustomerUatDraft(input: {
  tenantId: string
  draft: CustomerAnalysisDraft
}): CustomerUatDraftTask[] {
  return input.draft.uat_criteria.map((criteria, index) => {
    const title = summarizeTitle(criteria, `P4 UAT ${index + 1}`)
    return {
      id: `p4-uat-${index + 1}`,
      order: index + 1,
      tenant_id: input.tenantId,
      title,
      description: [
        cleanText(criteria, 1000),
        '',
        `Source: P4 blueprint for ${input.tenantId}.`,
        `Delivery mode: ${input.draft.delivery_mode}.`,
      ].join('\n'),
      acceptance_criteria: [cleanText(criteria, 1000)],
      source: 'p4-blueprint',
    }
  })
}

export function buildCustomerBlueprintPayload(state: CustomerAnalysisState): CustomerBlueprintPayload {
  if (!state.draft || !state.intakeRawHash) {
    throw new Error('P4 machine-readable blueprint is required')
  }
  const skillsBlueprint = buildCustomerSkillsBlueprint(state.draft)
  return {
    tenant_id: state.tenantId,
    intake_raw_hash: state.intakeRawHash,
    analysis_path: state.analysisPath,
    analysis_exists: state.analysisExists,
    analysis_matches_intake: state.analysisMatchesIntake === true,
    mode: state.mode,
    workflow_steps: state.draft.workflow_steps,
    delivery_mode: state.draft.delivery_mode,
    delivery_mode_reason: state.draft.delivery_mode_reason,
    skills_blueprint: skillsBlueprint,
    skill_candidates: skillsBlueprint,
    boundary_rules: buildCustomerBoundaryRulesDraft({ tenantId: state.tenantId, draft: state.draft }),
    boundary_draft: state.draft.boundary_draft,
    uat_tasks: buildCustomerUatDraft({ tenantId: state.tenantId, draft: state.draft }),
    uat_criteria: state.draft.uat_criteria,
    soul_draft: state.draft.soul_draft,
  }
}
