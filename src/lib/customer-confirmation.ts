import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { normalizeCustomerTenantId } from '@/lib/customer-intake'
import { resolveWithin } from '@/lib/paths'

export const CUSTOMER_CONFIRMATION_DEFAULT_TEXT = 'Clare 已审阅 intake-raw.md，确认开始 tenant 部署。'

export interface CustomerConfirmationState {
  tenantId: string
  intakeRawPath: string
  confirmationPath: string
  intakeRawExists: boolean
  intakeRawHash: string | null
  intakeRawPreview: string
  confirmationExists: boolean
  confirmationContent: string | null
}

export interface CustomerConfirmationInput {
  tenantId: string
  signedBy: string
  confirmationText?: string
  signedAt?: Date
}

export interface CustomerConfirmationResult {
  tenantId: string
  path: string
  content: string
  alreadyExists: boolean
  intakeRawHash: string
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

export async function resolveCustomerVaultFilePath(
  tenantId: string,
  fileName: 'intake-raw.md' | 'confirmation-cc.md',
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
  const confirmation = await resolveCustomerVaultFilePath(normalizedTenantId, 'confirmation-cc.md')

  const intakeRawExists = await fileExists(intakeRaw.physicalPath)
  const intakeRawContent = intakeRawExists ? await readFile(intakeRaw.physicalPath, 'utf8') : ''
  const confirmationExists = await fileExists(confirmation.physicalPath)
  const confirmationContent = confirmationExists ? await readFile(confirmation.physicalPath, 'utf8') : null

  return {
    tenantId: normalizedTenantId,
    intakeRawPath: intakeRaw.relativePath,
    confirmationPath: confirmation.relativePath,
    intakeRawExists,
    intakeRawHash: intakeRawExists ? sha256Hex(intakeRawContent) : null,
    intakeRawPreview: intakeRawContent.split('\n').slice(0, previewLines).join('\n'),
    confirmationExists,
    confirmationContent,
  }
}

export function buildCustomerConfirmationMarkdown(input: {
  tenantId: string
  signedBy: string
  signedAt: Date
  intakeRawHash: string
  confirmationText: string
}): string {
  return `# Confirmation CC

> Source: OB-S3 Clare manual confirmation
> Gate: customer onboarding S03

## Confirmation

| Field | Value |
|---|---|
| tenant_id | ${markdownEscape(input.tenantId)} |
| timestamp | ${input.signedAt.toISOString()} |
| signed_by | ${markdownEscape(input.signedBy)} |
| intake_raw_hash | ${markdownEscape(input.intakeRawHash)} |

## Confirmation Text

${cleanDisplayValue(input.confirmationText) || CUSTOMER_CONFIRMATION_DEFAULT_TEXT}
`
}

export async function confirmCustomerOnboarding(input: CustomerConfirmationInput): Promise<CustomerConfirmationResult> {
  const tenantId = normalizeCustomerTenantId(input.tenantId)
  const intakeRaw = await resolveCustomerVaultFilePath(tenantId, 'intake-raw.md')
  const confirmation = await resolveCustomerVaultFilePath(tenantId, 'confirmation-cc.md')

  let intakeRawContent: string
  try {
    intakeRawContent = await readFile(intakeRaw.physicalPath, 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error('vault/intake-raw.md is required before OB-S3 confirmation')
    }
    throw error
  }
  if (!intakeRawContent.trim()) {
    throw new Error('vault/intake-raw.md is empty; run OB-S1 before OB-S3 confirmation')
  }

  const intakeRawHash = sha256Hex(intakeRawContent)
  const existing = await fileExists(confirmation.physicalPath)
  if (existing) {
    return {
      tenantId,
      path: confirmation.relativePath,
      content: await readFile(confirmation.physicalPath, 'utf8'),
      alreadyExists: true,
      intakeRawHash,
    }
  }

  const content = buildCustomerConfirmationMarkdown({
    tenantId,
    signedBy: input.signedBy,
    signedAt: input.signedAt ?? new Date(),
    intakeRawHash,
    confirmationText: input.confirmationText || CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
  })

  await mkdir(path.dirname(confirmation.physicalPath), { recursive: true })
  try {
    await writeFile(confirmation.physicalPath, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      return {
        tenantId,
        path: confirmation.relativePath,
        content: await readFile(confirmation.physicalPath, 'utf8'),
        alreadyExists: true,
        intakeRawHash,
      }
    }
    throw error
  }

  return {
    tenantId,
    path: confirmation.relativePath,
    content,
    alreadyExists: false,
    intakeRawHash,
  }
}
