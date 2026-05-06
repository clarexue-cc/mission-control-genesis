import 'server-only'

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { readCustomerAnalysisState } from '@/lib/customer-analysis'
import { buildCustomerUatDraft } from '@/lib/customer-blueprint'
import { resolveWithin } from '@/lib/paths'
import { normalizeTenantId } from '@/lib/tenant-id'

export const UAT_TASKS_FILE = 'uat-tasks.jsonl'
export const UAT_SUBMISSIONS_FILE = 'uat-submissions.jsonl'

export type UatTaskStatus = 'open' | 'closed'
export type UatCustomerTaskStatus = UatTaskStatus | 'submitted'

export interface UatTaskRecord {
  id: string
  tenant_id: string
  title: string
  description: string
  status: UatTaskStatus
  created_by: string
  created_at: string
}

export interface UatSubmissionRecord {
  id: string
  task_id: string
  tenant_id: string
  submitted_by: string
  response_text: string
  feedback_options: string[]
  feedback_notes: string
  rating: number
  submitted_at: string
}

export interface UatCustomerTask extends UatTaskRecord {
  customer_status: UatCustomerTaskStatus
  submitted_at?: string
  latest_submission?: UatSubmissionRecord
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\0/g, '').trim().slice(0, maxLength)
}

function normalizeTextArray(value: unknown, maxItems = 8): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => cleanText(item, 80))
    .filter(Boolean)
    .slice(0, maxItems)
}

function parseJsonLine<T>(line: string): T | null {
  if (!line.trim()) return null
  try {
    const parsed = JSON.parse(line)
    return parsed && typeof parsed === 'object' ? parsed as T : null
  } catch {
    return null
  }
}

async function canRead(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function tenantFilePath(tenantIdInput: unknown, fileName: string): Promise<{ tenantId: string; filePath: string }> {
  const tenantId = normalizeTenantId(tenantIdInput)
  const root = await resolveHarnessRoot()
  const relativePath = `phase0/tenants/${tenantId}/${fileName}`
  return {
    tenantId,
    filePath: resolveWithin(root, relativePath),
  }
}

async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  if (!await canRead(filePath)) return []
  const content = await readFile(filePath, 'utf8')
  return content
    .split('\n')
    .map(line => parseJsonLine<T>(line))
    .filter((entry): entry is T => Boolean(entry))
}

async function appendJsonlRecord(filePath: string, record: object) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
}

function sortNewestFirst<T extends { created_at?: string; submitted_at?: string }>(records: T[]): T[] {
  return [...records].sort((a, b) => {
    const left = new Date(a.submitted_at || a.created_at || 0).getTime()
    const right = new Date(b.submitted_at || b.created_at || 0).getTime()
    return right - left
  })
}

export async function createUatTask(input: {
  tenant_id: unknown
  title: unknown
  description?: unknown
  created_by: string
  now?: Date
}): Promise<UatTaskRecord> {
  const { tenantId, filePath } = await tenantFilePath(input.tenant_id, UAT_TASKS_FILE)
  const title = cleanText(input.title, 180)
  if (!title) throw new Error('title is required')

  const task: UatTaskRecord = {
    id: `uat_${randomUUID()}`,
    tenant_id: tenantId,
    title,
    description: cleanText(input.description, 4000),
    status: 'open',
    created_by: input.created_by,
    created_at: (input.now || new Date()).toISOString(),
  }

  await appendJsonlRecord(filePath, task)
  return task
}

export async function materializeP4UatDraftTasks(input: {
  tenant_id: unknown
  created_by?: string
  now?: Date
}): Promise<UatTaskRecord[]> {
  const { tenantId, filePath } = await tenantFilePath(input.tenant_id, UAT_TASKS_FILE)
  const state = await readCustomerAnalysisState(tenantId)
  if (state.analysisMatchesIntake === false || !state.draft) return []

  const existing = await readJsonlFile<UatTaskRecord>(filePath)
  const existingKeys = new Set(
    existing
      .filter(task => task.tenant_id === tenantId)
      .map(task => `${task.title}\n${task.description}`),
  )
  const created: UatTaskRecord[] = []

  for (const draftTask of buildCustomerUatDraft({ tenantId, draft: state.draft })) {
    const title = cleanText(draftTask.title, 180)
    if (!title) continue
    const description = cleanText(draftTask.description, 4000)
    const key = `${title}\n${description}`
    if (existingKeys.has(key)) continue

    const task: UatTaskRecord = {
      id: `uat_${randomUUID()}`,
      tenant_id: tenantId,
      title,
      description,
      status: 'open',
      created_by: input.created_by || 'p4-blueprint',
      created_at: (input.now || new Date()).toISOString(),
    }
    await appendJsonlRecord(filePath, task)
    existingKeys.add(key)
    created.push(task)
  }

  return created
}

export async function listUatTasks(tenantIdInput: unknown): Promise<UatTaskRecord[]> {
  const { tenantId, filePath } = await tenantFilePath(tenantIdInput, UAT_TASKS_FILE)
  const tasks = await readJsonlFile<UatTaskRecord>(filePath)
  return sortNewestFirst(tasks.filter(task => task.tenant_id === tenantId && typeof task.id === 'string'))
}

export async function listUatSubmissions(tenantIdInput: unknown, taskId?: string): Promise<UatSubmissionRecord[]> {
  const { tenantId, filePath } = await tenantFilePath(tenantIdInput, UAT_SUBMISSIONS_FILE)
  const submissions = await readJsonlFile<UatSubmissionRecord>(filePath)
  return sortNewestFirst(submissions.filter(submission => (
    submission.tenant_id === tenantId
    && typeof submission.task_id === 'string'
    && (!taskId || submission.task_id === taskId)
  )))
}

export async function listCustomerUatTasks(tenantIdInput: unknown): Promise<UatCustomerTask[]> {
  const tenantId = normalizeTenantId(tenantIdInput)
  await materializeP4UatDraftTasks({ tenant_id: tenantId })
  const [tasks, submissions] = await Promise.all([
    listUatTasks(tenantId),
    listUatSubmissions(tenantId),
  ])

  const latestByTask = new Map<string, UatSubmissionRecord>()
  for (const submission of submissions) {
    if (!latestByTask.has(submission.task_id)) latestByTask.set(submission.task_id, submission)
  }

  return tasks.map(task => {
    const latest = latestByTask.get(task.id)
    return {
      ...task,
      customer_status: latest ? 'submitted' : task.status,
      submitted_at: latest?.submitted_at,
      latest_submission: latest,
    }
  })
}

export async function getUatTask(tenantIdInput: unknown, taskId: string): Promise<UatTaskRecord | null> {
  const tasks = await listUatTasks(tenantIdInput)
  return tasks.find(task => task.id === taskId) || null
}

export async function submitUatTask(input: {
  tenant_id: unknown
  task_id: string
  submitted_by: string
  response_text: unknown
  feedback_options?: unknown
  feedback_notes?: unknown
  rating: unknown
  now?: Date
}): Promise<UatSubmissionRecord> {
  const { tenantId, filePath } = await tenantFilePath(input.tenant_id, UAT_SUBMISSIONS_FILE)
  const task = await getUatTask(tenantId, input.task_id)
  if (!task) throw new Error('UAT task not found')

  const rating = Number(input.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('rating must be an integer from 1 to 5')
  }

  const responseText = cleanText(input.response_text, 6000)
  const feedbackNotes = cleanText(input.feedback_notes, 4000)
  if (!responseText && !feedbackNotes) {
    throw new Error('response_text or feedback_notes is required')
  }

  const submission: UatSubmissionRecord = {
    id: `uats_${randomUUID()}`,
    task_id: input.task_id,
    tenant_id: tenantId,
    submitted_by: input.submitted_by,
    response_text: responseText,
    feedback_options: normalizeTextArray(input.feedback_options),
    feedback_notes: feedbackNotes,
    rating,
    submitted_at: (input.now || new Date()).toISOString(),
  }

  await appendJsonlRecord(filePath, submission)
  return submission
}
