import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readCustomerAnalysisState, type CustomerSkillCandidate } from '@/lib/customer-analysis'
import { normalizeCustomerTenantId } from '@/lib/customer-intake'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { resolveWithin } from '@/lib/paths'
import { TENANT_ID_RE } from '@/lib/tenant-id'

export type CustomerSkillFileStatus = 'created' | 'unchanged' | 'exists-different'

export interface CustomerSkillFileRecord {
  skill_id: string
  skill_name: string
  title: string
  path: string
  status: CustomerSkillFileStatus
  hash: string
}

export interface CustomerSkillFilesResult {
  tenant_id: string
  skills_dir: string
  generated: CustomerSkillFileRecord[]
  created: number
  unchanged: number
  skipped: number
}

interface CustomerSkillFilesPaths {
  tenantId: string
  skillsRelativeDir: string
  skillsPhysicalDir: string
}

async function fileReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function cleanDisplayValue(value: string): string {
  return value.replace(/[\0\r]/g, '').trim()
}

function markdownEscape(value: string): string {
  return cleanDisplayValue(value).replace(/\|/g, '\\|')
}

function normalizeSkillFileName(raw: string, fallback: string): string {
  const normalized = `${raw || fallback}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/g, '')

  if (TENANT_ID_RE.test(normalized)) return normalized
  throw new Error(`Invalid generated skill name: ${raw || fallback}`)
}

function uniqueSkillNames(skills: CustomerSkillCandidate[]): Map<CustomerSkillCandidate, string> {
  const used = new Set<string>()
  const names = new Map<CustomerSkillCandidate, string>()
  skills.forEach((skill, index) => {
    const base = normalizeSkillFileName(skill.id || skill.title, `skill-${index + 1}`)
    let name = base
    let suffix = 2
    while (used.has(name)) {
      name = normalizeSkillFileName(`${base}-${suffix}`, `skill-${index + 1}-${suffix}`)
      suffix += 1
    }
    used.add(name)
    names.set(skill, name)
  })
  return names
}

export async function resolveCustomerSkillFilesPaths(tenantIdInput: string): Promise<CustomerSkillFilesPaths> {
  const tenantId = normalizeCustomerTenantId(tenantIdInput)
  const harnessRoot = await resolveHarnessRoot()
  const skillsRelativeDir = `phase0/tenants/${tenantId}/vault/skills`
  return {
    tenantId,
    skillsRelativeDir,
    skillsPhysicalDir: resolveWithin(harnessRoot, skillsRelativeDir),
  }
}

export function buildCustomerSkillFileContent(input: {
  tenantId: string
  analysisPath: string
  intakeRawHash: string
  skill: CustomerSkillCandidate
}): string {
  const skill = input.skill
  return `# ${cleanDisplayValue(skill.title || skill.id)}

> Source: P9 customer-specific Skill file
> Tenant: ${input.tenantId}
> Skill ID: ${cleanDisplayValue(skill.id)}
> Intake Raw Hash: ${input.intakeRawHash}
> P4 Blueprint: ${input.analysisPath}

## P4 Blueprint Fields

| Field | Value |
|---|---|
| order | ${skill.order} |
| workflow_stage | ${markdownEscape(skill.workflow_stage)} |
| inputs | ${markdownEscape(skill.inputs.join(' / '))} |
| outputs | ${markdownEscape(skill.outputs.join(' / '))} |
| handoff | ${markdownEscape(skill.handoff)} |
| human_confirmation | ${markdownEscape(skill.human_confirmation)} |
| reason | ${markdownEscape(skill.reason)} |

## Operating Contract

1. Read the listed inputs before starting this skill.
2. Produce only the listed outputs unless a later confirmed handoff expands scope.
3. Stop at the human confirmation gate when the blueprint requires review.
4. Hand off using the destination and context named in the P4 blueprint.
`
}

export async function generateCustomerSkillFiles(tenantIdInput: string): Promise<CustomerSkillFilesResult> {
  const paths = await resolveCustomerSkillFilesPaths(tenantIdInput)
  const state = await readCustomerAnalysisState(paths.tenantId)
  if (!state.analysisExists) {
    throw new Error('vault/intake-analysis.md is required before P9 Skill file generation')
  }
  if (state.analysisMatchesIntake === false) {
    throw new Error('vault/intake-analysis.md was generated from a different intake-raw.md hash; rerun P4 before P9')
  }
  if (!state.draft || !state.intakeRawHash) {
    throw new Error('P4 machine-readable Skills blueprint is required before P9 Skill file generation')
  }

  await mkdir(paths.skillsPhysicalDir, { recursive: true })
  const names = uniqueSkillNames(state.draft.skill_candidates)
  const generated: CustomerSkillFileRecord[] = []

  for (const skill of state.draft.skill_candidates) {
    const skillName = names.get(skill) || normalizeSkillFileName(skill.id, `skill-${skill.order}`)
    const relativePath = `${paths.skillsRelativeDir}/${skillName}.md`
    const physicalPath = resolveWithin(paths.skillsPhysicalDir, `${skillName}.md`)
    const content = buildCustomerSkillFileContent({
      tenantId: paths.tenantId,
      analysisPath: state.analysisPath,
      intakeRawHash: state.intakeRawHash,
      skill,
    })
    const hash = sha256Hex(content)
    let status: CustomerSkillFileStatus = 'created'

    if (await fileReadable(physicalPath)) {
      const existing = await readFile(physicalPath, 'utf8')
      status = existing === content ? 'unchanged' : 'exists-different'
    } else {
      await writeFile(physicalPath, content, { encoding: 'utf8', flag: 'wx' })
    }

    generated.push({
      skill_id: skill.id,
      skill_name: skillName,
      title: skill.title,
      path: relativePath,
      status,
      hash,
    })
  }

  return {
    tenant_id: paths.tenantId,
    skills_dir: paths.skillsRelativeDir,
    generated,
    created: generated.filter(item => item.status === 'created').length,
    unchanged: generated.filter(item => item.status === 'unchanged').length,
    skipped: generated.filter(item => item.status === 'exists-different').length,
  }
}
