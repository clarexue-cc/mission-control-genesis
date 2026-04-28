import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { readCustomerAnalysisState } from '@/lib/customer-analysis'
import { normalizeCustomerTenantId } from '@/lib/customer-intake'
import { resolveWithin } from '@/lib/paths'

export const CUSTOMER_CONFIRMATION_DEFAULT_TEXT = 'Clare 已审阅并确认 P4 客户蓝图，批准进入 tenant 部署。'

export interface CustomerConfirmationState {
  tenantId: string
  intakeRawPath: string
  intakeAnalysisPath: string
  confirmationPath: string
  intakeRawExists: boolean
  intakeAnalysisExists: boolean
  intakeRawHash: string | null
  intakeAnalysisHash: string | null
  intakeRawPreview: string
  intakeAnalysisPreview: string
  confirmationExists: boolean
  confirmationContent: string | null
  confirmationAnalysisHash: string | null
  confirmationMatchesAnalysis: boolean | null
}

export interface CustomerConfirmationInput {
  tenantId: string
  signedBy: string
  confirmationText?: string
  signedAt?: Date
  replaceExisting?: boolean
}

export interface CustomerConfirmationResult {
  tenantId: string
  path: string
  content: string
  alreadyExists: boolean
  intakeRawHash: string
  intakeAnalysisHash: string
  replacedExisting: boolean
}

function cleanDisplayValue(value: string): string {
  return value.replace(/[\0\r]/g, '').trim()
}

function markdownEscape(value: string): string {
  return cleanDisplayValue(value).replace(/\|/g, '\\|')
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function parseConfirmationAnalysisHash(content: string | null): string | null {
  if (!content) return null
  const match = /\|\s*intake_analysis_hash\s*\|\s*([a-f0-9]{64})\s*\|/i.exec(content)
  return match?.[1] || null
}

export async function resolveCustomerVaultFilePath(
  tenantId: string,
  fileName: 'intake-raw.md' | 'intake-analysis.md' | 'confirmation-cc.md',
): Promise<{ relativePath: string; physicalPath: string }> {
  const normalizedTenantId = normalizeCustomerTenantId(tenantId)
  const harnessRoot = await resolveHarnessRoot()
  const relativePath = `phase0/tenants/${normalizedTenantId}/vault/${fileName}`
  return {
    relativePath,
    physicalPath: resolveWithin(harnessRoot, relativePath),
  }
}

export async function readCustomerConfirmationState(
  tenantId: string,
  previewLines = 18,
): Promise<CustomerConfirmationState> {
  const normalizedTenantId = normalizeCustomerTenantId(tenantId)
  const intakeRaw = await resolveCustomerVaultFilePath(normalizedTenantId, 'intake-raw.md')
  const intakeAnalysis = await resolveCustomerVaultFilePath(normalizedTenantId, 'intake-analysis.md')
  const confirmation = await resolveCustomerVaultFilePath(normalizedTenantId, 'confirmation-cc.md')

  const intakeRawExists = await fileExists(intakeRaw.physicalPath)
  const intakeRawContent = intakeRawExists ? await readFile(intakeRaw.physicalPath, 'utf8') : ''
  const intakeAnalysisExists = await fileExists(intakeAnalysis.physicalPath)
  const intakeAnalysisContent = intakeAnalysisExists ? await readFile(intakeAnalysis.physicalPath, 'utf8') : ''
  const confirmationExists = await fileExists(confirmation.physicalPath)
  const confirmationContent = confirmationExists ? await readFile(confirmation.physicalPath, 'utf8') : null
  const intakeAnalysisHash = intakeAnalysisExists ? sha256Hex(intakeAnalysisContent) : null
  const confirmationAnalysisHash = parseConfirmationAnalysisHash(confirmationContent)

  return {
    tenantId: normalizedTenantId,
    intakeRawPath: intakeRaw.relativePath,
    intakeAnalysisPath: intakeAnalysis.relativePath,
    confirmationPath: confirmation.relativePath,
    intakeRawExists,
    intakeAnalysisExists,
    intakeRawHash: intakeRawExists ? sha256Hex(intakeRawContent) : null,
    intakeAnalysisHash,
    intakeRawPreview: intakeRawContent.split('\n').slice(0, previewLines).join('\n'),
    intakeAnalysisPreview: intakeAnalysisContent.split('\n').slice(0, previewLines).join('\n'),
    confirmationExists,
    confirmationContent,
    confirmationAnalysisHash,
    confirmationMatchesAnalysis: confirmationExists && intakeAnalysisHash
      ? confirmationAnalysisHash === intakeAnalysisHash
      : null,
  }
}

export function buildCustomerConfirmationMarkdown(input: {
  tenantId: string
  signedBy: string
  signedAt: Date
  intakeRawHash: string
  intakeAnalysisHash: string
  confirmationText: string
}): string {
  return `# Confirmation CC

> Source: P5 Clare approval gate
> Gate: customer onboarding approval before tenant deployment

## Confirmation

| Field | Value |
|---|---|
| tenant_id | ${markdownEscape(input.tenantId)} |
| timestamp | ${input.signedAt.toISOString()} |
| signed_by | ${markdownEscape(input.signedBy)} |
| intake_raw_hash | ${markdownEscape(input.intakeRawHash)} |
| intake_analysis_hash | ${markdownEscape(input.intakeAnalysisHash)} |

## Confirmation Text

${cleanDisplayValue(input.confirmationText) || CUSTOMER_CONFIRMATION_DEFAULT_TEXT}
`
}

export async function confirmCustomerOnboarding(input: CustomerConfirmationInput): Promise<CustomerConfirmationResult> {
  const tenantId = normalizeCustomerTenantId(input.tenantId)
  const intakeRaw = await resolveCustomerVaultFilePath(tenantId, 'intake-raw.md')
  const intakeAnalysis = await resolveCustomerVaultFilePath(tenantId, 'intake-analysis.md')
  const confirmation = await resolveCustomerVaultFilePath(tenantId, 'confirmation-cc.md')

  let intakeRawContent: string
  try {
    intakeRawContent = await readFile(intakeRaw.physicalPath, 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error('vault/intake-raw.md is required before P5 approval')
    }
    throw error
  }
  if (!intakeRawContent.trim()) {
    throw new Error('vault/intake-raw.md is empty; run P3 intake before P5 approval')
  }

  const analysisState = await readCustomerAnalysisState(tenantId)
  if (!analysisState.analysisExists || !analysisState.analysisContent?.trim()) {
    throw new Error('vault/intake-analysis.md is required before P5 approval')
  }
  if (analysisState.analysisMatchesIntake === false) {
    throw new Error('vault/intake-analysis.md does not match current intake-raw.md; rerun P4 before P5 approval')
  }

  const intakeAnalysisContent = await readFile(intakeAnalysis.physicalPath, 'utf8')
  const intakeRawHash = sha256Hex(intakeRawContent)
  const intakeAnalysisHash = sha256Hex(intakeAnalysisContent)
  const existing = await fileExists(confirmation.physicalPath)
  if (existing && !input.replaceExisting) {
    return {
      tenantId,
      path: confirmation.relativePath,
      content: await readFile(confirmation.physicalPath, 'utf8'),
      alreadyExists: true,
      intakeRawHash,
      intakeAnalysisHash,
      replacedExisting: false,
    }
  }

  const content = buildCustomerConfirmationMarkdown({
    tenantId,
    signedBy: input.signedBy,
    signedAt: input.signedAt ?? new Date(),
    intakeRawHash,
    intakeAnalysisHash,
    confirmationText: input.confirmationText || CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
  })

  await mkdir(path.dirname(confirmation.physicalPath), { recursive: true })
  try {
    await writeFile(confirmation.physicalPath, content, { encoding: 'utf8', flag: input.replaceExisting ? 'w' : 'wx' })
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      return {
        tenantId,
        path: confirmation.relativePath,
        content: await readFile(confirmation.physicalPath, 'utf8'),
        alreadyExists: true,
        intakeRawHash,
        intakeAnalysisHash,
        replacedExisting: false,
      }
    }
    throw error
  }

  return {
    tenantId,
    path: confirmation.relativePath,
    content,
    alreadyExists: existing,
    intakeRawHash,
    intakeAnalysisHash,
    replacedExisting: existing,
  }
}
