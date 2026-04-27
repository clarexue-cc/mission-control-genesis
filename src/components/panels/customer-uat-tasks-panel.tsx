'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

type UatTaskStatus = 'open' | 'closed' | 'submitted'

interface UatSubmission {
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

interface UatTask {
  id: string
  tenant_id: string
  title: string
  description: string
  status: 'open' | 'closed'
  customer_status: UatTaskStatus
  created_by: string
  created_at: string
  submitted_at?: string
  latest_submission?: UatSubmission
}

interface UatFormState {
  response_text: string
  feedback_options: string[]
  feedback_notes: string
  rating: number
}

const feedbackChoices = ['结果正确', '内容有帮助', '语气合适', '需要修改', '可以上线']
const defaultTenantId = 'tenant-tg-001'
const panelClassName = 'rounded-lg border border-border bg-card/70'

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function statusLabel(status: UatTaskStatus) {
  if (status === 'submitted') return '已提交'
  if (status === 'closed') return '已关闭'
  return '待提交'
}

function statusClass(status: UatTaskStatus) {
  if (status === 'submitted') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
  if (status === 'closed') return 'border-muted bg-secondary/60 text-muted-foreground'
  return 'border-amber-500/25 bg-amber-500/10 text-amber-200'
}

function emptyForm(): UatFormState {
  return {
    response_text: '',
    feedback_options: [],
    feedback_notes: '',
    rating: 5,
  }
}

function toggleOption(options: string[], option: string) {
  return options.includes(option)
    ? options.filter(item => item !== option)
    : [...options, option]
}

export function CustomerUatTasksPanel() {
  const { activeTenant } = useMissionControl()
  const tenantId = activeTenant?.slug || defaultTenantId
  const [tasks, setTasks] = useState<UatTask[]>([])
  const [forms, setForms] = useState<Record<string, UatFormState>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      setError(null)
      const params = new URLSearchParams({ role: 'customer', tenant_id: tenantId })
      const response = await fetch(`/api/tasks/uat?${params}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load UAT tasks')
      const nextTasks: UatTask[] = Array.isArray(data.tasks) ? data.tasks : []
      setTasks(nextTasks)
      setForms(current => {
        const next = { ...current }
        for (const task of nextTasks) {
          if (!next[task.id]) next[task.id] = emptyForm()
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load UAT tasks')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const pendingCount = useMemo(
    () => tasks.filter(task => task.customer_status === 'open').length,
    [tasks],
  )

  async function submitTask(task: UatTask) {
    const form = forms[task.id] || emptyForm()
    setSubmittingId(task.id)
    setSubmittedMessage(null)
    try {
      const response = await fetch(`/api/tasks/uat/${encodeURIComponent(task.id)}/submit?role=customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          response_text: form.response_text,
          feedback_options: form.feedback_options,
          feedback_notes: form.feedback_notes,
          rating: form.rating,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit feedback')
      setForms(current => ({ ...current, [task.id]: emptyForm() }))
      setSubmittedMessage(`${task.title} 已提交`)
      await fetchTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <section className={`${panelClassName} p-5`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">UAT 任务</h1>
            <p className="mt-1 text-sm text-muted-foreground">验收任务与反馈提交</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">{tenantId}</span>
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary">{pendingCount} 待提交</span>
            <Button variant="outline" size="sm" onClick={fetchTasks} disabled={loading}>刷新</Button>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {submittedMessage && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {submittedMessage}
        </div>
      )}

      <section className={`${panelClassName} overflow-hidden`}>
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">任务列表</h2>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">Loading UAT tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">暂无需要验收的任务。</div>
        ) : (
          <div className="divide-y divide-border">
            {tasks.map(task => {
              const form = forms[task.id] || emptyForm()
              const submitted = task.customer_status === 'submitted'
              const disabled = submittingId === task.id || task.status === 'closed'
              return (
                <article key={task.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">{task.title}</h3>
                      <span className={`rounded-md border px-2 py-0.5 text-xs ${statusClass(task.customer_status)}`}>
                        {statusLabel(task.customer_status)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{task.description || '无描述'}</p>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div>创建时间：{formatDateTime(task.created_at)}</div>
                      <div>提交时间：{formatDateTime(task.submitted_at)}</div>
                    </div>
                    {task.latest_submission && (
                      <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-xs text-emerald-100">
                        最近评分：{task.latest_submission.rating}/5
                        {task.latest_submission.feedback_options.length > 0 && ` · ${task.latest_submission.feedback_options.join(' / ')}`}
                      </div>
                    )}
                  </div>

                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      submitTask(task)
                    }}
                  >
                    <label className="block text-xs font-medium text-muted-foreground">
                      提交 input
                      <textarea
                        value={form.response_text}
                        onChange={(event) => setForms(current => ({
                          ...current,
                          [task.id]: { ...form, response_text: event.target.value },
                        }))}
                        disabled={disabled}
                        className="mt-1 h-24 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder="输入验收结果或交付确认"
                      />
                    </label>

                    <div>
                      <div className="text-xs font-medium text-muted-foreground">反馈表</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {feedbackChoices.map(choice => (
                          <label key={choice} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 py-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={form.feedback_options.includes(choice)}
                              disabled={disabled}
                              onChange={() => setForms(current => ({
                                ...current,
                                [task.id]: { ...form, feedback_options: toggleOption(form.feedback_options, choice) },
                              }))}
                            />
                            <span>{choice}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <label className="block text-xs font-medium text-muted-foreground">
                      文本反馈
                      <textarea
                        value={form.feedback_notes}
                        onChange={(event) => setForms(current => ({
                          ...current,
                          [task.id]: { ...form, feedback_notes: event.target.value },
                        }))}
                        disabled={disabled}
                        className="mt-1 h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder="补充说明"
                      />
                    </label>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map(score => (
                          <button
                            key={score}
                            type="button"
                            disabled={disabled}
                            onClick={() => setForms(current => ({ ...current, [task.id]: { ...form, rating: score } }))}
                            className={`h-8 w-8 rounded-md border text-xs transition ${
                              form.rating === score
                                ? 'border-primary bg-primary/20 text-primary'
                                : 'border-border bg-background text-muted-foreground hover:text-foreground'
                            } disabled:opacity-50`}
                          >
                            {score}
                          </button>
                        ))}
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={disabled || (!form.response_text.trim() && !form.feedback_notes.trim())}
                      >
                        {submittingId === task.id ? '提交中' : submitted ? '再次提交' : '提交'}
                      </Button>
                    </div>
                  </form>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export function AdminUatControlPanel() {
  const { activeTenant } = useMissionControl()
  const [tenantId, setTenantId] = useState(activeTenant?.slug || defaultTenantId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tasks, setTasks] = useState<UatTask[]>([])
  const [selectedTask, setSelectedTask] = useState<UatTask | null>(null)
  const [submissions, setSubmissions] = useState<UatSubmission[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (activeTenant?.slug) setTenantId(activeTenant.slug)
  }, [activeTenant?.slug])

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams({ tenant_id: tenantId })
    const response = await fetch(`/api/tasks/uat?${params}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to load UAT tasks')
    setTasks(Array.isArray(data.tasks) ? data.tasks : [])
  }, [tenantId])

  useEffect(() => {
    fetchTasks().catch(() => {})
  }, [fetchTasks])

  async function createTask(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    try {
      const response = await fetch('/api/tasks/uat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, title, description }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create UAT task')
      setTitle('')
      setDescription('')
      setStatus(`Created ${data.task?.id || 'UAT task'}`)
      await fetchTasks()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to create UAT task')
    } finally {
      setLoading(false)
    }
  }

  async function loadSubmissions(task: UatTask) {
    setSelectedTask(task)
    setStatus(null)
    try {
      const params = new URLSearchParams({ tenant_id: tenantId })
      const response = await fetch(`/api/tasks/uat/${encodeURIComponent(task.id)}/submissions?${params}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load submissions')
      setSubmissions(Array.isArray(data.submissions) ? data.submissions : [])
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load submissions')
      setSubmissions([])
    }
  }

  return (
    <section className="border-b border-border bg-surface-0 px-4 py-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(360px,480px)_minmax(0,1fr)_minmax(320px,420px)]">
        <form onSubmit={createTask} className="rounded-lg border border-border bg-card/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">UAT Admin</h3>
            <input
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              className="h-8 w-36 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              aria-label="tenant_id"
            />
          </div>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-3 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="UAT task title"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-2 h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="Task description"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button type="submit" size="sm" disabled={loading || !tenantId.trim() || !title.trim()}>
              Create UAT Task
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => fetchTasks()} disabled={loading}>
              Refresh
            </Button>
          </div>
          {status && <div className="mt-3 text-xs text-muted-foreground">{status}</div>}
        </form>

        <div className="rounded-lg border border-border bg-card/70">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">UAT Tasks</div>
          <div className="max-h-72 overflow-auto divide-y divide-border">
            {tasks.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">No UAT tasks for {tenantId}</div>
            ) : tasks.map(task => (
              <button
                key={task.id}
                type="button"
                onClick={() => loadSubmissions(task)}
                className="grid w-full gap-1 px-4 py-3 text-left hover:bg-secondary/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{task.title}</span>
                  <span className={`rounded-md border px-2 py-0.5 text-xs ${statusClass(task.customer_status)}`}>{statusLabel(task.customer_status)}</span>
                </div>
                <div className="text-xs text-muted-foreground">{task.id}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/70">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
            Submissions{selectedTask ? ` · ${selectedTask.title}` : ''}
          </div>
          <div className="max-h-72 overflow-auto divide-y divide-border">
            {!selectedTask ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">Select a UAT task</div>
            ) : submissions.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">No submissions yet</div>
            ) : submissions.map(submission => (
              <div key={submission.id} className="space-y-2 px-4 py-3">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{submission.submitted_by}</span>
                  <span>{formatDateTime(submission.submitted_at)}</span>
                </div>
                <div className="text-sm text-foreground">Rating {submission.rating}/5</div>
                <div className="whitespace-pre-wrap text-xs text-muted-foreground">{submission.response_text || submission.feedback_notes}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
