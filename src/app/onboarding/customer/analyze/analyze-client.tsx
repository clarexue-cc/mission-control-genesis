'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

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
  workflow_steps: WorkflowStep[]
  skill_candidates: SkillCandidate[]
  delivery_mode: string | null
  boundary_draft: string[]
  uat_criteria: string[]
}

interface AnalyzeResult {
  ok: boolean
  tenant_id: string
  path: string
  content: string
  mode: string
  provider: string
  already_exists: boolean
  workflow_steps: WorkflowStep[]
  skill_candidates: SkillCandidate[]
  delivery_mode: string
  boundary_draft: string[]
  uat_criteria: string[]
}

type Progress = 'pending' | 'analyzing' | 'success' | 'failed'

function previewText(value: string | null | undefined, maxLines = 28): string {
  return (value || '').split('\n').slice(0, maxLines).join('\n')
}

export function CustomerAnalyzeClient({ username }: { username: string }) {
  const [tenantId, setTenantId] = useState('demo-dry-run-2')
  const [state, setState] = useState<AnalyzeState | null>(null)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [progress, setProgress] = useState<Progress>('pending')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const tenantInputRef = useRef<HTMLInputElement>(null)

  const analysisContent = result?.content || state?.content || ''
  const mode = result?.mode || state?.mode || null
  const workflowSteps = useMemo(() => result?.workflow_steps || state?.workflow_steps || [], [result?.workflow_steps, state?.workflow_steps])
  const skillCandidates = useMemo(() => result?.skill_candidates || state?.skill_candidates || [], [result?.skill_candidates, state?.skill_candidates])
  const boundaryDraft = useMemo(() => result?.boundary_draft || state?.boundary_draft || [], [result?.boundary_draft, state?.boundary_draft])
  const uatCriteria = useMemo(() => result?.uat_criteria || state?.uat_criteria || [], [result?.uat_criteria, state?.uat_criteria])
  const deliveryMode = result?.delivery_mode || state?.delivery_mode || null
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

  async function loadState(nextTenantId = tenantId) {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/onboarding/customer/analyze?tenant_id=${encodeURIComponent(nextTenantId)}`)
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
    loadState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function analyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setProgress('analyzing')
    setError('')
    try {
      const response = await fetch('/api/onboarding/customer/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId }),
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

  return (
    <main className="min-h-screen overflow-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="border-b border-border pb-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">OB-S2</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal">AI 分析 intake</h1>
            </div>
            {mode && (
              <span className="rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                {mode}
              </span>
            )}
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            读取 vault/intake-raw.md，生成候选 Skills、Pipeline/Toolkit/Hybrid 判断、Boundary 草稿和 UAT 标准。
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <form onSubmit={analyze} className="space-y-5 rounded-lg border border-border bg-card p-5">
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

          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">客户交付蓝图</h2>
                <p className="mt-1 text-xs text-muted-foreground">输出文件：phase0/tenants/&lt;tenant&gt;/vault/intake-analysis.md</p>
              </div>
              {mode && <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">{mode}</span>}
            </div>

            <div className="mt-4 space-y-4">
              {workflowSteps.length > 0 ? (
                <div className="rounded-md border border-border bg-background p-4">
                  <h3 className="text-sm font-semibold">客户 Workflow 拆解</h3>
                  <div className="mt-3 space-y-3">
                    {workflowSteps.map(step => (
                      <div key={`${step.order}-${step.name}`} className="border-l-2 border-primary/50 pl-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span className="text-primary">P{step.order}</span>
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

              <div className="rounded-md border border-border bg-background p-4">
                <h3 className="text-sm font-semibold">候选 Skills 蓝图</h3>
                {skillCandidates.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {skillCandidates
                      .slice()
                      .sort((left, right) => (left.order || 0) - (right.order || 0))
                      .map(skill => (
                        <div key={skill.id} className="rounded-md border border-border px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                              {skill.order || '-'}
                            </span>
                            <span className="text-sm font-semibold">{skill.title}</span>
                            <span className="text-xs text-muted-foreground">{skill.id}</span>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{skill.reason}</p>
                          <div className="mt-2 grid gap-2 text-xs leading-relaxed text-muted-foreground md:grid-cols-2">
                            <p><span className="font-medium text-foreground">workflow：</span>{skill.workflow_stage || '待补'}</p>
                            <p><span className="font-medium text-foreground">人工确认：</span>{skill.human_confirmation || '待补'}</p>
                            <p><span className="font-medium text-foreground">输入：</span>{(skill.inputs || []).join(' / ') || '待补'}</p>
                            <p><span className="font-medium text-foreground">输出：</span>{(skill.outputs || []).join(' / ') || '待补'}</p>
                            <p className="md:col-span-2"><span className="font-medium text-foreground">交接：</span>{skill.handoff || '待补'}</p>
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

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-border bg-background p-4">
                  <h3 className="text-sm font-semibold">交付模式</h3>
                  {deliveryMode ? (
                    <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                      <p>模式：{deliveryMode}</p>
                      <p>{deliveryMode === 'Hybrid' ? '固定流程 + 随时追问/工具调用' : '由 intake 分析决定后续部署形态'}</p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">分析完成后显示 Pipeline / Toolkit / Hybrid 判断。</p>
                  )}
                </div>
                <div className="rounded-md border border-border bg-background p-4">
                  <h3 className="text-sm font-semibold">Boundary 草稿</h3>
                  {boundaryDraft.length > 0 ? (
                    <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs leading-relaxed text-muted-foreground">
                      {boundaryDraft.map(rule => <li key={rule}>{rule}</li>)}
                    </ol>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">分析完成后显示后续 P8 的护栏草稿。</p>
                  )}
                </div>
                <div className="rounded-md border border-border bg-background p-4 md:col-span-2">
                  <h3 className="text-sm font-semibold">UAT 草稿</h3>
                  {uatCriteria.length > 0 ? (
                    <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs leading-relaxed text-muted-foreground">
                      {uatCriteria.map(criteria => <li key={criteria}>{criteria}</li>)}
                    </ol>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">分析完成后显示后续 P21 的验收任务草稿。</p>
                  )}
                </div>
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
