import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { resolveWithin } from '@/lib/paths'

export const CUSTOMER_INTAKE_MAX_BYTES = 100 * 1024 * 1024

const TENANT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const FALLBACK_ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])

export interface CustomerIntakeWriteInput {
  tenantId: string
  tenantName?: string
  fileName: string
  fileType: string
  fileSize: number
  uploadedBy: string
  summary?: string
  originalText?: string
  uploadedAt?: Date
}

export interface CustomerIntakeWriteResult {
  tenantId: string
  relativePath: string
  physicalPath: string
  content: string
}

export function normalizeCustomerTenantId(value: unknown): string {
  const tenantId = typeof value === 'string' ? value.trim() : ''
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error('Tenant ID must use lowercase letters, numbers, and hyphens')
  }
  return tenantId
}

export function isAllowedCustomerIntakeFile(fileName: string, fileType: string): boolean {
  const normalizedType = fileType.toLowerCase()
  if (normalizedType.startsWith('audio/') || normalizedType.startsWith('text/')) return true
  return FALLBACK_ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

function cleanDisplayValue(value: string): string {
  return value.replace(/[\0\r]/g, '').trim()
}

function markdownEscape(value: string): string {
  return cleanDisplayValue(value).replace(/\|/g, '\\|')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export async function resolveCustomerIntakePath(tenantId: string): Promise<{ relativePath: string; physicalPath: string }> {
  const normalizedTenantId = normalizeCustomerTenantId(tenantId)
  const harnessRoot = await resolveHarnessRoot()
  const relativePath = `phase0/tenants/${normalizedTenantId}/vault/intake-raw.md`
  return {
    relativePath,
    physicalPath: resolveWithin(harnessRoot, relativePath),
  }
}

export function buildCustomerIntakeMarkdown(input: CustomerIntakeWriteInput): string {
  const uploadedAt = input.uploadedAt ?? new Date()
  const tenantName = cleanDisplayValue(input.tenantName || '')
  const summary = cleanDisplayValue(input.summary || '')
  const originalText = input.originalText?.trim()
  const fileType = cleanDisplayValue(input.fileType || 'unknown')
  const sourceName = path.basename(cleanDisplayValue(input.fileName || 'upload'))
  const transcriptionNote = fileType.startsWith('audio/')
    ? '录音转文字暂未实现；本文件记录上传元数据和人工摘要 mock。'
    : '文本文件内容已写入下方原始材料区。'

  return `# Intake Raw

> Source: OB-S1 customer intake upload
> Mode: demo/mock transcription

## Tenant

| Field | Value |
|---|---|
| Tenant ID | ${markdownEscape(input.tenantId)} |
| Tenant Name | ${tenantName ? markdownEscape(tenantName) : '(not provided)'} |
| Uploaded By | ${markdownEscape(input.uploadedBy)} |
| Uploaded At | ${uploadedAt.toISOString()} |

## Source File

| Field | Value |
|---|---|
| File Name | ${markdownEscape(sourceName)} |
| MIME Type | ${markdownEscape(fileType)} |
| Size | ${formatBytes(input.fileSize)} |

## 用户输入摘要

${summary || '- (not provided)'}

## 转写状态

${transcriptionNote}

## 原始材料

${originalText || '[audio-upload] 原始音频已接收；等待后续 OB-S2/转写接入。'}
`
}

export async function writeCustomerIntake(input: CustomerIntakeWriteInput): Promise<CustomerIntakeWriteResult> {
  const tenantId = normalizeCustomerTenantId(input.tenantId)
  const { relativePath, physicalPath } = await resolveCustomerIntakePath(tenantId)
  const content = buildCustomerIntakeMarkdown({ ...input, tenantId })

  await mkdir(path.dirname(physicalPath), { recursive: true })
  await writeFile(physicalPath, content, 'utf8')

  return {
    tenantId,
    relativePath,
    physicalPath,
    content,
  }
}
