import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { resolveWithin } from '@/lib/paths'
import { TENANT_ID_RE, normalizeTenantId } from '@/lib/tenant-id'

export const CUSTOMER_INTAKE_MAX_BYTES = 100 * 1024 * 1024

const FALLBACK_ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])
export { TENANT_ID_RE }

export interface IntakeAgentRow {
  name: string
  scenario: string
  base: string
  priority: string
}

export interface IntakeStructuredData {
  layer1: {
    c1: string
    c2: { budget: string; timeline: string; agent_count: string }
    c3: string
    c4: IntakeAgentRow[]
    c5: string
    c6: string
  }
  layer2: {
    s1: string
    s2: string
    s3: string
    s4: string
    s5: string
    s6: string
  }
}

export interface CustomerIntakeWriteInput {
  tenantId: string
  tenantName?: string
  fileName?: string
  fileType?: string
  fileSize?: number
  uploadedBy: string
  summary?: string
  originalText?: string
  intakeData?: IntakeStructuredData
  uploadedAt?: Date
}

export interface CustomerIntakeWriteResult {
  tenantId: string
  relativePath: string
  physicalPath: string
  content: string
}

export function normalizeCustomerTenantId(value: unknown): string {
  return normalizeTenantId(value)
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

function buildStructuredSection(data: IntakeStructuredData): string {
  const { layer1: l1, layer2: l2 } = data
  const lines: string[] = []

  lines.push('## 第一层：客户整体画像')
  lines.push('')
  lines.push('### C1 · 客户是谁')
  lines.push(l1.c1 || '(未填写)')
  lines.push('')
  lines.push('### C2 · 合同概览')
  lines.push('| 项目 | 内容 |')
  lines.push('|---|---|')
  lines.push(`| 预算 | ${markdownEscape(l1.c2.budget || '(未填写)')} |`)
  lines.push(`| 时间线 | ${markdownEscape(l1.c2.timeline || '(未填写)')} |`)
  lines.push(`| Agent 总数 | ${markdownEscape(l1.c2.agent_count || '(未填写)')} |`)
  lines.push('')
  lines.push('### C3 · 公司级红线')
  lines.push(l1.c3 || '(未填写)')
  lines.push('')
  lines.push('### C4 · 全景 Agent 清单')
  if (l1.c4.length > 0) {
    lines.push('| Agent | 场景 | 底座 | 优先级 |')
    lines.push('|---|---|---|---|')
    for (const a of l1.c4) {
      lines.push(`| ${markdownEscape(a.name)} | ${markdownEscape(a.scenario)} | ${markdownEscape(a.base)} | ${markdownEscape(a.priority)} |`)
    }
  } else {
    lines.push('(未填写)')
  }
  lines.push('')
  lines.push('### C5 · Vault 分组')
  lines.push(l1.c5 || '(未填写)')
  lines.push('')
  lines.push('### C6 · 优先级与复用逻辑')
  lines.push(l1.c6 || '(未填写)')
  lines.push('')

  lines.push('## 第二层：单 Agent 画像')
  lines.push('')
  lines.push('### S1 · 所属场景')
  lines.push(l2.s1 || '(未填写)')
  lines.push('')
  lines.push('### S2 · 业务平台/渠道')
  lines.push(l2.s2 || '(未填写)')
  lines.push('')
  lines.push('### S3 · 定性')
  lines.push(l2.s3 || '(未填写)')
  lines.push('')
  lines.push('### S4 · 核心问题')
  lines.push(l2.s4 || '(未填写)')
  lines.push('')
  lines.push('### S5 · 客户预期')
  lines.push(l2.s5 || '(未填写)')
  lines.push('')
  lines.push('### S6 · ROI 前期数据')
  lines.push(l2.s6 || '(未填写)')
  lines.push('')

  return lines.join('\n')
}

export function buildCustomerIntakeMarkdown(input: CustomerIntakeWriteInput): string {
  const uploadedAt = input.uploadedAt ?? new Date()
  const tenantName = cleanDisplayValue(input.tenantName || '')
  const originalText = input.originalText?.trim()
  const hasFile = Boolean(input.fileName)
  const fileType = cleanDisplayValue(input.fileType || '')
  const sourceName = hasFile ? path.basename(cleanDisplayValue(input.fileName || 'upload')) : ''

  const structuredBlock = input.intakeData ? buildStructuredSection(input.intakeData) : ''

  const fileBlock = hasFile ? `## 上传文件

| Field | Value |
|---|---|
| File Name | ${markdownEscape(sourceName)} |
| MIME Type | ${markdownEscape(fileType || 'unknown')} |
| Size | ${formatBytes(input.fileSize || 0)} |

## 原始材料

${originalText || (fileType.startsWith('audio/') ? '[audio-upload] 原始音频已接收；等待转写接入。' : '(无文本内容)')}
` : ''

  return `# Intake Raw

> Source: P3 客户接入
> Date: ${uploadedAt.toISOString().slice(0, 10)}

## Tenant

| Field | Value |
|---|---|
| Tenant ID | ${markdownEscape(input.tenantId)} |
| Tenant Name | ${tenantName ? markdownEscape(tenantName) : '(not provided)'} |
| Uploaded By | ${markdownEscape(input.uploadedBy)} |

${structuredBlock}${fileBlock}`
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
