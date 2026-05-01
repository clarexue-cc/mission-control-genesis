'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

interface SkillCandidate {
  id: string
  title: string
  order?: number
  workflow_stage?: string
  inputs?: string[]
  outputs?: string[]
  handoff?: string
  human_confirmation?: string
  reason: string
}

interface WorkflowStep {
  order: number
  name: string
  actor: string
  trigger: string
  output: string
  next: string
}

interface SoulDraft {
  name: string
  role: string
  tone: string
  forbidden: string[]
}

interface BlueprintDraft {
  workflow_steps: WorkflowStep[]
  skill_candidates: SkillCandidate[]
  delivery_mode: string
  delivery_mode_reason: string
  boundary_draft: string[]
  uat_criteria: string[]
  soul_draft: SoulDraft
}

interface AnalyzeState {
  ok: boolean
  tenant_id: string
  intake_raw_path: string
  intake_raw_exists: boolean
  intake_raw_hash: string | null
  intake_raw_preview: string
  analysis_path: string
  analysis_exists: boolean
  analysis_intake_raw_hash: string | null
  analysis_matches_intake: boolean | null
  content: string | null
  mode: string | null
  draft: BlueprintDraft | null
  workflow_steps: WorkflowStep[]
  skill_candidates: SkillCandidate[]
  delivery_mode: string | null
  boundary_draft: string[]
  uat_criteria: string[]
  soul_draft: SoulDraft | null
}

interface AnalyzeResult {
  ok: boolean
  tenant_id: string
  path: string
  content: string
  mode: string
  provider: string
  already_exists: boolean
  draft: BlueprintDraft
  workflow_steps: WorkflowStep[]
  skill_candidates: SkillCandidate[]
  delivery_mode: string
  boundary_draft: string[]
  uat_criteria: string[]
  soul_draft: SoulDraft | null
}

type Progress = 'pending' | 'analyzing' | 'success' | 'failed'
type EditorSection = 'workflow' | 'soul' | 'skills' | 'boundary' | 'uat'

const DEFAULT_TENANT_ID = resolveDefaultCustomerTenantId()
const DELIVERY_MODES = ['Pipeline', 'Toolkit', 'Hybrid']
const EDITOR_SECTIONS: Array<{ id: EditorSection; label: string }> = [
  { id: 'workflow', label: 'Workflow' },
  { id: 'soul', label: '角色' },
  { id: 'skills', label: 'Skills' },
  { id: 'boundary', label: 'Boundary' },
  { id: 'uat', label: 'UAT' },
]

function previewText(value: string | null | undefined, maxLines = 28): string {
  return (value || '').split('\n').slice(0, maxLines).join('\n')
}

function parseBlueprintDraftFromAnalysis(content: string): BlueprintDraft | null {
  const match = /## 机器可读蓝图 JSON\s*```json\s*([\s\S]*?)\s*```/m.exec(content)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1]) as BlueprintDraft
  } catch {
    return null
  }
}

function cloneBlueprintDraft(draft: BlueprintDraft | null): BlueprintDraft | null {
  return draft ? JSON.parse(JSON.stringify(draft)) as BlueprintDraft : null
}

function listToText(values: string[] | undefined): string {
  return (values || []).join('\n')
}

function textToList(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean)
}

export function CustomerAnalyzeClient({ username }: { username: string }) {
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [state, setState] = useState<AnalyzeState | null>(null)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [progress, setProgress] = useState<Progress>('pending')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editableDraft, setEditableDraft] = useState<BlueprintDraft | null>(null)
  const [editorSection, setEditorSection] = useState<EditorSection>('workflow')
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const tenantInputRef = useRef<HTMLInputElement>(null)

  const analysisContent = result?.content || state?.content || ''
  const mode = result?.mode || state?.mode || null
  const blueprintDraft = useMemo(
    () => result?.draft || state?.draft || parseBlueprintDraftFromAnalysis(analysisContent),
    [analysisContent, result?.draft, state?.draft],
  )
  const activeDraft = editableDraft || blueprintDraft
  const workflowSteps = useMemo(() => activeDraft?.workflow_steps || result?.workflow_steps || state?.workflow_steps || [], [activeDraft?.workflow_steps, result?.workflow_steps, state?.workflow_steps])
  const skillCandidates = useMemo(() => activeDraft?.skill_candidates || result?.skill_candidates || state?.skill_candidates || [], [activeDraft?.skill_candidates, result?.skill_candidates, state?.skill_candidates])
  const boundaryDraft = useMemo(() => activeDraft?.boundary_draft || result?.boundary_draft || state?.boundary_draft || [], [activeDraft?.boundary_draft, result?.boundary_draft, state?.boundary_draft])
  const uatCriteria = useMemo(() => activeDraft?.uat_criteria || result?.uat_criteria || state?.uat_criteria || [], [activeDraft?.uat_criteria, result?.uat_criteria, state?.uat_criteria])
  const deliveryMode = activeDraft?.delivery_mode || result?.delivery_mode || state?.delivery_mode || null
  const soulDraft = activeDraft?.soul_draft || result?.soul_draft || state?.soul_draft || null
  const orderedSkillCandidates = useMemo(
    () => skillCandidates
      .map((skill, index) => ({ skill, index }))
      .sort((left, right) => (left.skill.order || 0) - (right.skill.order || 0)),
    [skillCandidates],
  )
  const candidateLines = useMemo(() => {
    if (skillCandidates.length) {
      return skillCandidates.map(skill => `${skill.id}: ${skill.title} - ${skill.reason}`)
    }
    return analysisContent
      .split('\n')
      .filter(line => line.trim().startsWith('- '))
      .slice(0, 5)
      .map(line => line.replace(/^- /, ''))
  }, [analysisContent, skillCandidates])

  useEffect(() => {
    setEditableDraft(cloneBlueprintDraft(blueprintDraft))
    setDraftError('')
    setDraftMessage('')
  }, [blueprintDraft])

  async function loadState(nextTenantId = tenantId) {
    const normalizedTenantId = nextTenantId.trim() || DEFAULT_TENANT_ID
    setTenantId(normalizedTenantId)
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/onboarding/customer/analyze?tenant_id=${encodeURIComponent(normalizedTenantId)}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '读取 OB-S2 状态失败')
      setState(body)
      setResult(null)
      setProgress(body.analysis_exists ? 'success' : 'pending')
    } catch (err: any) {
      setError(err?.message || '读取 OB-S2 状态失败')
      setState(null)
      setResult(null)
      setProgress('failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    loadState(params.get('tenant') || params.get('tenant_id') || DEFAULT_TENANT_ID)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function analyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setProgress('analyzing')
    setError('')
    try {
      const normalizedTenantId = tenantId.trim() || DEFAULT_TENANT_ID
      setTenantId(normalizedTenantId)
      const response = await fetch('/api/onboarding/customer/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: normalizedTenantId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'AI 分析失败')
      setResult(body)
      setState(current => current
        ? {
          ...current,
          analysis_exists: true,
          analysis_path: body.path,
          content: body.content,
          mode: body.mode,
          draft: body.draft,
          workflow_steps: body.workflow_steps,
          skill_candidates: body.skill_candidates,
          delivery_mode: body.delivery_mode,
          boundary_draft: body.boundary_draft,
          uat_criteria: body.uat_criteria,
          soul_draft: body.soul_draft,
        }
        : current)
      setProgress('success')
    } catch (err: any) {
      setError(err?.message || 'AI 分析失败')
      setProgress('failed')
    } finally {
      setLoading(false)
    }
  }

  async function saveBlueprintDraft() {
    setDraftSaving(true)
    setDraftError('')
    setDraftMessage('')

    if (!editableDraft) {
      setDraftError('还没有可保存的蓝图，请先完成 AI 分析。')
      setDraftSaving(false)
      return
    }

    try {
      const normalizedTenantId = tenantId.trim() || DEFAULT_TENANT_ID
      const response = await fetch('/api/onboarding/customer/analyze', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: normalizedTenantId, draft: editableDraft }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '保存蓝图失败')
      setTenantId(normalizedTenantId)
      setResult(body)
      setState(current => current
        ? {
          ...current,
          analysis_exists: true,
          analysis_path: body.path,
          analysis_matches_intake: true,
          content: body.content,
          mode: body.mode,
          draft: body.draft,
          workflow_steps: body.workflow_steps,
          skill_candidates: body.skill_candidates,
          delivery_mode: body.delivery_mode,
          boundary_draft: body.boundary_draft,
          uat_criteria: body.uat_criteria,
          soul_draft: body.soul_draft,
        }
        : current)
      setProgress('success')
      setDraftMessage('已保存到 intake-analysis.md，P8 / P9 / P18 会读取更新后的蓝图。')
    } catch (err: any) {
      setDraftError(err?.message || '保存蓝图失败')
    } finally {
      setDraftSaving(false)
    }
  }

  function editDraft(updater: (draft: BlueprintDraft) => BlueprintDraft) {
    setEditableDraft(current => {
      if (!current) return current
      setDraftError('')
      setDraftMessage('')
      return updater(cloneBlueprintDraft(current) || current)
    })
  }

  function updateWorkflowStep(index: number, updates: Partial<WorkflowStep>) {
    editDraft(draft => ({
      ...draft,
      workflow_steps: draft.workflow_steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...updates } : step),
    }))
  }

  function updateSkill(index: number, updates: Partial<SkillCandidate>) {
    editDraft(draft => ({
      ...draft,
      skill_candidates: draft.skill_candidates.map((skill, skillIndex) => skillIndex === index ? { ...skill, ...updates } : skill),
    }))
  }

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex h-full w-full max-w-[96rem] flex-col gap-4 px-4 py-4 sm:px-6">
        <header className="shrink-0 border-b border-border pb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P4 / OB-S2</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">P4 客户蓝图生成</h1>
            </div>
            <div className="flex items-center gap-2">
              {mode && (
                <span className="rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                  {mode}
                </span>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/">返回 MC 主页面</Link>
              </Button>
            </div>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            读取 vault/intake-raw.md，生成 Workflow、SOUL/AGENTS 输入、候选 Skills、Boundary 草稿和 UAT 标准。
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-primary">P4 蓝图草稿</span>
            <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">P7 SOUL/AGENTS 输入</span>
            <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">P8 Boundary</span>
            <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">P9 Skills</span>
            <span className="rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">P18 UAT</span>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:grid-rows-1 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <form onSubmit={analyze} className="min-h-0 space-y-4 overflow-y-auto rounded-lg border border-border bg-card p-4">
            <div>
              <label className="text-sm font-medium" htmlFor="tenant-id">Tenant ID</label>
              <div className="mt-2 flex gap-2">
                <input
                  id="tenant-id"
                  ref={tenantInputRef}
                  value={tenantId}
                  onChange={(event) => {
                    setTenantId(event.target.value)
                    setState(null)
                    setResult(null)
                    setProgress('pending')
                    setError('')
                  }}
                  required
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  placeholder="edu-luolaoshi-v1"
                />
                <Button type="button" variant="outline" onClick={() => loadState(tenantInputRef.current?.value || tenantId)} disabled={loading}>
                  {loading ? '读取中...' : '读取'}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">分析操作者：{username}</p>
            </div>

            {state && (
              <div className="space-y-2 rounded-md border border-border bg-background px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">intake-raw.md</span>
                  <span className={state.intake_raw_exists ? 'text-primary' : 'text-destructive'}>
                    {state.intake_raw_exists ? '已找到' : '缺失'}
                  </span>
                </div>
                <div className="break-all text-xs text-muted-foreground">{state.intake_raw_path}</div>
                {state.intake_raw_hash && (
                  <div className="break-all text-xs text-muted-foreground">sha256: {state.intake_raw_hash}</div>
                )}
              </div>
            )}

            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {(['pending', 'analyzing', 'success', 'failed'] as Progress[]).map(step => (
                <div
                  key={step}
                  className={`rounded-md border px-2 py-2 ${
                    progress === step ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  {step}
                </div>
              ))}
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {result?.already_exists && (
              <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
                intake-analysis.md 已存在，本次分析未覆盖原文件。
              </div>
            )}

            {state?.analysis_matches_intake === false && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                intake-analysis.md 与当前 intake-raw.md hash 不一致，请先归档旧分析再继续。
              </div>
            )}

            <Button type="submit" disabled={loading || !state?.intake_raw_exists} className="w-full">
              {progress === 'analyzing' ? '分析中...' : 'AI 分析'}
            </Button>
          </form>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card p-4">
            <div className="shrink-0 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">客户交付蓝图</h2>
                <p className="mt-1 text-xs text-muted-foreground">落盘文件：phase0/tenants/&lt;tenant&gt;/vault/intake-analysis.md</p>
              </div>
              {mode && <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">{mode}</span>}
            </div>

            <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
              {workflowSteps.length > 0 ? (
                <div className="rounded-md border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">客户 Workflow 拆解</h3>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs text-primary">P4</span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">输入 P5 SOUL/AGENTS</span>
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {workflowSteps.map(step => (
                      <div key={`${step.order}-${step.name}`} className="border-l-2 border-primary/50 pl-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span className="text-primary">阶段 {step.order}</span>
                          <span>{step.name}</span>
                          <span className="text-xs text-muted-foreground">负责人：{step.actor}</span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          触发：{step.trigger} ｜ 输出：{step.output} ｜ 下一步：{step.next}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-md border border-border bg-background p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">交付模式判断</h3>
                  <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs text-primary">P4</span>
                </div>
                <div className="grid overflow-hidden rounded-md border border-border bg-muted/30 text-center text-xs font-medium md:grid-cols-3">
                  {DELIVERY_MODES.map(option => {
                    const active = deliveryMode?.toLowerCase() === option.toLowerCase()
                    return (
                      <div
                        key={option}
                        className={`px-3 py-2 ${
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {option}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">蓝图文字编辑</h3>
                    <p className="mt-1 text-xs text-muted-foreground">直接改下面的普通文字；保存后写回 intake-analysis.md，并同步 P8 / P9 / P18。</p>
                  </div>
                  <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs text-primary">不用改 JSON</span>
                </div>
                {activeDraft ? (
                  <>
                    <div className="mt-3 grid overflow-hidden rounded-md border border-border bg-background text-xs font-medium sm:grid-cols-5">
                      {EDITOR_SECTIONS.map(section => (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => setEditorSection(section.id)}
                          aria-pressed={editorSection === section.id}
                          className={`px-3 py-2 ${
                            editorSection === section.id
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          {section.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 rounded-md border border-border bg-background p-3">
                      {editorSection === 'workflow' && (
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">交付模式</p>
                            <div className="mt-1 grid overflow-hidden rounded-md border border-border bg-muted/30 text-center text-xs font-medium sm:grid-cols-3">
                              {DELIVERY_MODES.map(option => {
                                const active = activeDraft.delivery_mode.toLowerCase() === option.toLowerCase()
                                return (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => editDraft(draft => ({ ...draft, delivery_mode: option }))}
                                    aria-pressed={active}
                                    className={`px-3 py-2 ${
                                      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                                    }`}
                                  >
                                    {option}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                          <label className="block text-xs font-medium text-muted-foreground">
                            模式判断理由
                            <textarea
                              value={activeDraft.delivery_mode_reason}
                              onChange={(event) => editDraft(draft => ({ ...draft, delivery_mode_reason: event.target.value }))}
                              className="mt-1 min-h-20 w-full resize-y rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                            />
                          </label>
                          {activeDraft.workflow_steps.map((step, index) => (
                            <div key={`workflow-editor-${index}`} className="rounded-md border border-border bg-card/60 p-3">
                              <div className="grid gap-2 md:grid-cols-[5rem_minmax(0,1fr)_minmax(0,10rem)]">
                                <label className="text-xs font-medium text-muted-foreground">
                                  顺序
                                  <input
                                    type="number"
                                    min={1}
                                    value={step.order}
                                    onChange={(event) => updateWorkflowStep(index, { order: Number(event.target.value) || index + 1 })}
                                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                                <label className="text-xs font-medium text-muted-foreground">
                                  阶段名称
                                  <input
                                    value={step.name}
                                    onChange={(event) => updateWorkflowStep(index, { name: event.target.value })}
                                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                                <label className="text-xs font-medium text-muted-foreground">
                                  负责人
                                  <input
                                    value={step.actor}
                                    onChange={(event) => updateWorkflowStep(index, { actor: event.target.value })}
                                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                              </div>
                              <div className="mt-2 grid gap-2 lg:grid-cols-3">
                                <label className="text-xs font-medium text-muted-foreground">
                                  触发条件
                                  <textarea
                                    value={step.trigger}
                                    onChange={(event) => updateWorkflowStep(index, { trigger: event.target.value })}
                                    className="mt-1 min-h-16 w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                                <label className="text-xs font-medium text-muted-foreground">
                                  输出
                                  <textarea
                                    value={step.output}
                                    onChange={(event) => updateWorkflowStep(index, { output: event.target.value })}
                                    className="mt-1 min-h-16 w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                                <label className="text-xs font-medium text-muted-foreground">
                                  下一步
                                  <textarea
                                    value={step.next}
                                    onChange={(event) => updateWorkflowStep(index, { next: event.target.value })}
                                    className="mt-1 min-h-16 w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {editorSection === 'soul' && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            角色名
                            <input
                              value={activeDraft.soul_draft.name}
                              onChange={(event) => editDraft(draft => ({ ...draft, soul_draft: { ...draft.soul_draft, name: event.target.value } }))}
                              className="mt-1 w-full rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                            />
                          </label>
                          <label className="text-xs font-medium text-muted-foreground">
                            语气
                            <input
                              value={activeDraft.soul_draft.tone}
                              onChange={(event) => editDraft(draft => ({ ...draft, soul_draft: { ...draft.soul_draft, tone: event.target.value } }))}
                              className="mt-1 w-full rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                            />
                          </label>
                          <label className="text-xs font-medium text-muted-foreground md:col-span-2">
                            核心职责
                            <textarea
                              value={activeDraft.soul_draft.role}
                              onChange={(event) => editDraft(draft => ({ ...draft, soul_draft: { ...draft.soul_draft, role: event.target.value } }))}
                              className="mt-1 min-h-24 w-full resize-y rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                            />
                          </label>
                          <label className="text-xs font-medium text-muted-foreground md:col-span-2">
                            禁止行为，每行一条
                            <textarea
                              value={listToText(activeDraft.soul_draft.forbidden)}
                              onChange={(event) => editDraft(draft => ({ ...draft, soul_draft: { ...draft.soul_draft, forbidden: textToList(event.target.value) } }))}
                              className="mt-1 min-h-24 w-full resize-y rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                            />
                          </label>
                        </div>
                      )}

                      {editorSection === 'skills' && (
                        <div className="space-y-3">
                          {activeDraft.skill_candidates.map((skill, index) => (
                            <div key={`skill-editor-${index}`} className="rounded-md border border-border bg-card/60 p-3">
                              <div className="grid gap-2 lg:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,13rem)]">
                                <label className="text-xs font-medium text-muted-foreground">
                                  顺序
                                  <input
                                    type="number"
                                    min={1}
                                    value={skill.order || index + 1}
                                    onChange={(event) => updateSkill(index, { order: Number(event.target.value) || index + 1 })}
                                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                                <label className="text-xs font-medium text-muted-foreground">
                                  Skill 标题
                                  <input
                                    value={skill.title}
                                    onChange={(event) => updateSkill(index, { title: event.target.value })}
                                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                                <label className="text-xs font-medium text-muted-foreground">
                                  文件名 / ID
                                  <input
                                    value={skill.id}
                                    onChange={(event) => updateSkill(index, { id: event.target.value })}
                                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                              </div>
                              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                                <label className="text-xs font-medium text-muted-foreground">
                                  Workflow 阶段
                                  <input
                                    value={skill.workflow_stage || ''}
                                    onChange={(event) => updateSkill(index, { workflow_stage: event.target.value })}
                                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                                <label className="text-xs font-medium text-muted-foreground">
                                  为什么需要这个 Skill
                                  <input
                                    value={skill.reason}
                                    onChange={(event) => updateSkill(index, { reason: event.target.value })}
                                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                  />
                                </label>
                              </div>
                              <details className="mt-2 rounded border border-border bg-background/70 px-3 py-2">
                                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">展开输入 / 输出 / 交接 / 人工确认</summary>
                                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                                  <label className="text-xs font-medium text-muted-foreground">
                                    输入，每行一条
                                    <textarea
                                      value={listToText(skill.inputs)}
                                      onChange={(event) => updateSkill(index, { inputs: textToList(event.target.value) })}
                                      className="mt-1 min-h-20 w-full resize-y rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                    />
                                  </label>
                                  <label className="text-xs font-medium text-muted-foreground">
                                    输出，每行一条
                                    <textarea
                                      value={listToText(skill.outputs)}
                                      onChange={(event) => updateSkill(index, { outputs: textToList(event.target.value) })}
                                      className="mt-1 min-h-20 w-full resize-y rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                    />
                                  </label>
                                  <label className="text-xs font-medium text-muted-foreground">
                                    交接说明
                                    <textarea
                                      value={skill.handoff || ''}
                                      onChange={(event) => updateSkill(index, { handoff: event.target.value })}
                                      className="mt-1 min-h-20 w-full resize-y rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                    />
                                  </label>
                                  <label className="text-xs font-medium text-muted-foreground">
                                    人工确认
                                    <textarea
                                      value={skill.human_confirmation || ''}
                                      onChange={(event) => updateSkill(index, { human_confirmation: event.target.value })}
                                      className="mt-1 min-h-20 w-full resize-y rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                                    />
                                  </label>
                                </div>
                              </details>
                            </div>
                          ))}
                        </div>
                      )}

                      {editorSection === 'boundary' && (
                        <label className="block text-xs font-medium text-muted-foreground">
                          Boundary 规则，每行一条
                          <textarea
                            value={listToText(activeDraft.boundary_draft)}
                            onChange={(event) => editDraft(draft => ({ ...draft, boundary_draft: textToList(event.target.value) }))}
                            className="mt-1 min-h-48 w-full resize-y rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                          />
                        </label>
                      )}

                      {editorSection === 'uat' && (
                        <label className="block text-xs font-medium text-muted-foreground">
                          UAT 验收项，每行一条
                          <textarea
                            value={listToText(activeDraft.uat_criteria)}
                            onChange={(event) => editDraft(draft => ({ ...draft, uat_criteria: textToList(event.target.value) }))}
                            className="mt-1 min-h-48 w-full resize-y rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                          />
                        </label>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs">
                        {draftError && <p className="text-destructive">{draftError}</p>}
                        {draftMessage && <p className="text-primary">{draftMessage}</p>}
                        {!draftError && !draftMessage && (
                          <p className="text-muted-foreground">上面改的是普通文字，后台会自动保留机器可读结构。</p>
                        )}
                      </div>
                      <Button type="button" onClick={saveBlueprintDraft} disabled={draftSaving}>
                        {draftSaving ? '保存中...' : '保存蓝图修改'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">分析完成后，这里会显示普通文字编辑区。</p>
                )}
              </div>

              <div className="rounded-md border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">SOUL / AGENTS 草稿要素</h3>
                  <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs text-primary">P5</span>
                </div>
                {soulDraft ? (
                  <div className="mt-3 grid gap-2 text-xs leading-relaxed text-muted-foreground md:grid-cols-2">
                    <div className="rounded border border-border bg-card/50 px-3 py-2">
                      <p className="font-medium text-foreground">角色名</p>
                      <p className="mt-1">{soulDraft.name}</p>
                    </div>
                    <div className="rounded border border-border bg-card/50 px-3 py-2">
                      <p className="font-medium text-foreground">语气</p>
                      <p className="mt-1">{soulDraft.tone}</p>
                    </div>
                    <div className="rounded border border-border bg-card/50 px-3 py-2 md:col-span-2">
                      <p className="font-medium text-foreground">核心职责</p>
                      <p className="mt-1">{soulDraft.role}</p>
                    </div>
                    <div className="rounded border border-border bg-card/50 px-3 py-2 md:col-span-2">
                      <p className="font-medium text-foreground">禁止行为</p>
                      <p className="mt-1">{soulDraft.forbidden.join(' / ')}</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">分析完成后显示后续 P5 生成 SOUL.md / AGENTS.md 的输入。</p>
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Boundary 草稿</h3>
                    <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs text-primary">P8 自动加载</span>
                  </div>
                  {boundaryDraft.length > 0 ? (
                    <ol className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                      {boundaryDraft.map((rule, index) => (
                        <li key={rule} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                            {index + 1}
                          </span>
                          <span>{rule}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">分析完成后显示后续 P8 的护栏草稿。</p>
                  )}
                </div>

                <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">UAT 草稿</h3>
                    <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs text-primary">P18 自动加载</span>
                  </div>
                  {uatCriteria.length > 0 ? (
                    <ol className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                      {uatCriteria.map((criteria, index) => (
                        <li key={criteria} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                            {index + 1}
                          </span>
                          <span>{criteria}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">分析完成后显示后续 P18 的验收任务草稿。</p>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">候选 Skills 蓝图</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs text-primary">P9 生成 .md</span>
                    {orderedSkillCandidates.length > 0 && (
                      <span className="text-xs text-muted-foreground">{orderedSkillCandidates.length} skills</span>
                    )}
                  </div>
                </div>
                {orderedSkillCandidates.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {orderedSkillCandidates.map(({ skill }) => (
                      <div key={skill.id} className="grid gap-3 rounded-md border border-border bg-card/50 px-3 py-3 md:grid-cols-[8rem_minmax(0,1fr)]">
                        <div className="space-y-2 border-b border-border pb-3 md:border-b-0 md:border-r md:pb-0 md:pr-3">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                            {skill.order || '-'}
                          </span>
                          <div>
                            <p className="text-xs font-medium text-foreground">{skill.workflow_stage || '待补 workflow'}</p>
                            <p className="mt-1 break-all text-[11px] leading-relaxed text-muted-foreground">{skill.id}</p>
                          </div>
                        </div>
                        <div>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <h4 className="text-sm font-semibold">{skill.title}</h4>
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{skill.reason}</p>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs leading-relaxed text-muted-foreground lg:grid-cols-2">
                            <div className="rounded border border-border bg-background/70 px-3 py-2">
                              <p className="font-medium text-foreground">输入</p>
                              <p className="mt-1">{(skill.inputs || []).join(' / ') || '待补'}</p>
                            </div>
                            <div className="rounded border border-border bg-background/70 px-3 py-2">
                              <p className="font-medium text-foreground">输出</p>
                              <p className="mt-1">{(skill.outputs || []).join(' / ') || '待补'}</p>
                            </div>
                            <div className="rounded border border-border bg-background/70 px-3 py-2">
                              <p className="font-medium text-foreground">交接</p>
                              <p className="mt-1">{skill.handoff || '待补'}</p>
                            </div>
                            <div className="rounded border border-border bg-background/70 px-3 py-2">
                              <p className="font-medium text-foreground">人工确认</p>
                              <p className="mt-1">{skill.human_confirmation || '待补'}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : candidateLines.length > 0 ? (
                  <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                    {candidateLines.map(line => <li key={line}>{line}</li>)}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">分析完成后显示候选 Skill 蓝图。</p>
                )}
              </div>

              <details className="rounded-md border border-border bg-background p-4">
                <summary className="cursor-pointer text-sm font-semibold">待分析内容预览</summary>
                {state?.intake_raw_preview ? (
                  <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {previewText(state.intake_raw_preview, 16)}
                  </pre>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">尚未读取到 intake-raw.md。请先完成 OB-S1 上传。</p>
                )}
              </details>

              <details className="rounded-md border border-border bg-background p-4">
                <summary className="cursor-pointer text-sm font-semibold">完整 markdown</summary>
                {analysisContent ? (
                  <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {analysisContent}
                  </pre>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">点击 AI 分析后，这里会显示 intake-analysis.md。</p>
                )}
              </details>
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}
