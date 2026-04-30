'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

interface WorkflowStep {
  order: number
  name: string
  actor: string
  trigger: string
  output: string
  next: string
}

interface SkillCandidate {
  id: string
  title: string
  order?: number
  workflow_stage?: string
  inputs?: string[]
  outputs?: string[]
  handoff?: string
  human_confirmation?: string
  reason?: string
}

interface SoulDraft {
  name: string
  role: string
  tone: string
  forbidden: string[]
}

interface BlueprintPayload {
  ok: boolean
  tenant_id: string
  intake_raw_hash: string
  analysis_path: string
  mode: string | null
  workflow_steps: WorkflowStep[]
  delivery_mode: string
  delivery_mode_reason: string
  skills_blueprint: SkillCandidate[]
  boundary_draft: string[]
  uat_criteria: string[]
  soul_draft: SoulDraft
}

interface ConfirmState {
  ok: boolean
  tenant_id: string
  intake_raw_path: string
  intake_raw_exists: boolean
  intake_raw_hash: string | null
  intake_raw_preview: string
  intake_analysis_path: string
  intake_analysis_exists: boolean
  intake_analysis_hash: string | null
  intake_analysis_preview: string
  confirmation_path: string
  confirmation_exists: boolean
  confirmation_analysis_hash: string | null
  confirmation_matches_analysis: boolean | null
  content: string | null
}

interface ConfirmResult {
  ok: boolean
  tenant_id: string
  path: string
  content: string
  already_exists: boolean
  replaced_existing: boolean
  intake_raw_hash: string
  intake_analysis_hash: string
  message: string
}

type ApprovalStatus = 'loading' | 'missing-intake' | 'missing-blueprint' | 'ready' | 'approved' | 'stale' | 'error'

const DEFAULT_CONFIRMATION_TEXT = 'Clare 已审阅并确认 P4 客户蓝图，批准进入 tenant 部署。'
const DEFAULT_TENANT_ID = resolveDefaultCustomerTenantId()

function shortHash(value: string | null | undefined): string {
  return value ? `${value.slice(0, 10)}...${value.slice(-8)}` : '未生成'
}

function previewText(value: string | null | undefined, maxLines = 16): string {
  return (value || '').split('\n').slice(0, maxLines).join('\n')
}

function approvalStatusFor(state: ConfirmState | null, error: string): ApprovalStatus {
  if (error) return 'error'
  if (!state) return 'loading'
  if (!state.intake_raw_exists) return 'missing-intake'
  if (!state.intake_analysis_exists) return 'missing-blueprint'
  if (state.confirmation_exists && state.confirmation_matches_analysis === true) return 'approved'
  if (state.confirmation_exists && state.confirmation_matches_analysis !== true) return 'stale'
  return 'ready'
}

function statusCopy(status: ApprovalStatus) {
  switch (status) {
    case 'approved':
      return {
        label: '审批已完成',
        tone: 'border-emerald-300 bg-emerald-50 text-emerald-900',
        detail: '当前 confirmation-cc.md 对应最新 P4 蓝图，可以进入 P6 部署。',
      }
    case 'stale':
      return {
        label: '需要重新审批',
        tone: 'border-amber-300 bg-amber-50 text-amber-950',
        detail: 'P4 蓝图已经变化，旧确认文档不再对应当前版本。',
      }
    case 'ready':
      return {
        label: '等待审批',
        tone: 'border-sky-300 bg-sky-50 text-sky-950',
        detail: 'P4 蓝图已读取，可以确认或退回修改。',
      }
    case 'missing-blueprint':
      return {
        label: '缺少 P4 蓝图',
        tone: 'border-rose-300 bg-rose-50 text-rose-950',
        detail: '请先完成 P4 Blueprint，再回到本页审批。',
      }
    case 'missing-intake':
      return {
        label: '缺少 intake',
        tone: 'border-rose-300 bg-rose-50 text-rose-950',
        detail: '请先完成 P3 Intake 上传。',
      }
    case 'error':
      return {
        label: '读取失败',
        tone: 'border-rose-300 bg-rose-50 text-rose-950',
        detail: '当前状态读取失败，请查看错误信息。',
      }
    default:
      return {
        label: '读取中',
        tone: 'border-slate-300 bg-slate-50 text-slate-700',
        detail: '正在读取 tenant 当前审批状态。',
      }
  }
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      {subtitle && <p className="mt-1 text-sm leading-6 text-slate-600">{subtitle}</p>}
    </div>
  )
}

function SummaryList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
          {item}
        </li>
      ))}
    </ul>
  )
}

export function CustomerConfirmClient({ username }: { username: string }) {
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID)
  const [confirmationText, setConfirmationText] = useState(DEFAULT_CONFIRMATION_TEXT)
  const [state, setState] = useState<ConfirmState | null>(null)
  const [blueprint, setBlueprint] = useState<BlueprintPayload | null>(null)
  const [result, setResult] = useState<ConfirmResult | null>(null)
  const [error, setError] = useState('')
  const [blueprintError, setBlueprintError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const status = approvalStatusFor(state, error)
  const copy = statusCopy(status)
  const canApprove = status === 'ready' || status === 'stale'
  const shouldReplaceExisting = status === 'stale'

  const orderedSkills = useMemo(
    () => (blueprint?.skills_blueprint || []).slice().sort((left, right) => (left.order || 0) - (right.order || 0)),
    [blueprint?.skills_blueprint],
  )
  const workflowSummary = useMemo(
    () => (blueprint?.workflow_steps || [])
      .slice()
      .sort((left, right) => left.order - right.order)
      .map(step => `${step.order}. ${step.name}：${step.output}`),
    [blueprint?.workflow_steps],
  )
  const skillSummary = useMemo(
    () => orderedSkills.map(skill => `${skill.order || '-'} · ${skill.id}：${skill.inputs?.join(' / ') || '输入待补'} → ${skill.outputs?.join(' / ') || '输出待补'}`),
    [orderedSkills],
  )

  async function loadState(nextTenantId = tenantId) {
    const normalizedTenantId = nextTenantId.trim() || DEFAULT_TENANT_ID
    setTenantId(normalizedTenantId)
    setLoading(true)
    setError('')
    setBlueprintError('')
    try {
      const [confirmResponse, blueprintResponse] = await Promise.all([
        fetch(`/api/onboarding/customer/confirm?tenant_id=${encodeURIComponent(normalizedTenantId)}`, { cache: 'no-store' }),
        fetch(`/api/onboarding/customer/blueprint?tenant_id=${encodeURIComponent(normalizedTenantId)}`, { cache: 'no-store' }),
      ])
      const confirmBody = await confirmResponse.json()
      if (!confirmResponse.ok) throw new Error(confirmBody?.error || '读取 P5 审批状态失败')
      setState(confirmBody)
      if (confirmBody.confirmation_exists && confirmBody.content) {
        setResult({
          ok: true,
          tenant_id: confirmBody.tenant_id,
          path: confirmBody.confirmation_path,
          content: confirmBody.content,
          already_exists: true,
          replaced_existing: false,
          intake_raw_hash: confirmBody.intake_raw_hash || '',
          intake_analysis_hash: confirmBody.intake_analysis_hash || '',
          message: 'confirmation-cc.md already exists; not overwritten',
        })
      } else {
        setResult(null)
      }

      const blueprintBody = await blueprintResponse.json()
      if (blueprintResponse.ok) {
        setBlueprint(blueprintBody)
      } else {
        setBlueprint(null)
        setBlueprintError(blueprintBody?.error || '未读取到 P4 蓝图')
      }
    } catch (err: any) {
      setError(err?.message || '读取 P5 审批状态失败')
      setState(null)
      setBlueprint(null)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    loadState(params.get('tenant') || params.get('tenant_id') || DEFAULT_TENANT_ID)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const normalizedTenantId = tenantId.trim() || DEFAULT_TENANT_ID
      setTenantId(normalizedTenantId)
      const response = await fetch('/api/onboarding/customer/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: normalizedTenantId,
          confirmation_text: confirmationText,
          replace_existing: shouldReplaceExisting,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || '审批确认失败')
      setResult(body)
      setState((current) => current
        ? {
          ...current,
          confirmation_exists: true,
          confirmation_path: body.path,
          content: body.content,
          intake_raw_hash: body.intake_raw_hash,
          intake_analysis_hash: body.intake_analysis_hash,
          confirmation_analysis_hash: body.intake_analysis_hash,
          confirmation_matches_analysis: true,
        }
        : current)
    } catch (err: any) {
      setError(err?.message || '审批确认失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen overflow-auto bg-[#f7f7f2] text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="border-b border-slate-300 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">P5 / Approval Gate</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">审批 P4 客户蓝图</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                本页不是重复分析 P4，而是确认 P4 蓝图可以进入 P6 部署。不同意时退回 P4 修改，同意后生成
                <span className="font-medium text-slate-900"> confirmation-cc.md </span>
                作为审批记录。
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="border-slate-300 bg-white text-slate-800 hover:bg-slate-50">
              <Link href="/">返回 MC 主页面</Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          {[
            ['P4 Blueprint', '核心内容在这里修改：workflow、skills、模式、Boundary、UAT。'],
            ['P5 Approval', '这里只做审批、退回和确认文档追踪。'],
            ['P6 Deploy', '审批通过后才允许初始化 tenant 和部署状态。'],
          ].map(([title, detail], index) => (
            <div key={title} className={`rounded-lg border px-4 py-3 ${index === 1 ? 'border-slate-900 bg-white shadow-sm' : 'border-slate-200 bg-white/75'}`}>
              <div className="text-sm font-semibold text-slate-950">{title}</div>
              <p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(360px,0.78fr)_minmax(0,1.22fr)]">
          <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <SectionTitle
              title="审批动作"
              subtitle="如果 P4 还要改，就退回 P4；如果认可当前蓝图，就确认审批进入部署。"
            />

            <div className="mt-5 space-y-5">
              <div>
                <label className="text-sm font-medium text-slate-800" htmlFor="tenant-id">Tenant ID</label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="tenant-id"
                    value={tenantId}
                    onChange={(event) => {
                      setTenantId(event.target.value)
                      setState(null)
                      setBlueprint(null)
                      setResult(null)
                      setError('')
                      setBlueprintError('')
                    }}
                    required
                    className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-slate-950"
                    placeholder="edu-luolaoshi-v1"
                  />
                  <Button type="button" variant="outline" onClick={() => loadState()} disabled={loading} className="border-slate-300 bg-white text-slate-800">
                    {loading ? '读取中...' : '读取'}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-slate-500">审批人：{username}</p>
              </div>

              <div className={`rounded-lg border px-4 py-3 ${copy.tone}`}>
                <div className="text-sm font-semibold">{copy.label}</div>
                <p className="mt-1 text-sm leading-6">{copy.detail}</p>
              </div>

              {error && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-950">
                  {error}
                </div>
              )}

              {blueprintError && !error && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                  {blueprintError}
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-slate-800" htmlFor="confirmation-text">审批意见</label>
                <textarea
                  id="confirmation-text"
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  className="mt-2 min-h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-950 outline-none focus:border-slate-950"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Button asChild variant="outline" className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50">
                  <Link href={`/onboarding/customer/analyze?role=admin&tenant=${encodeURIComponent(tenantId)}`}>
                    退回 P4 修改
                  </Link>
                </Button>
                <Button
                  type="submit"
                  disabled={submitting || loading || !canApprove}
                  className="bg-slate-950 text-white hover:bg-slate-800 disabled:bg-slate-300"
                >
                  {submitting
                    ? '审批中...'
                    : shouldReplaceExisting
                      ? '重新审批并更新确认文档'
                      : '确认审批，进入 P6 部署'}
                </Button>
              </div>

              {status === 'approved' && (
                <Button asChild className="w-full bg-emerald-700 text-white hover:bg-emerald-800">
                  <Link href={`/onboarding/customer/deploy?role=admin&tenant=${encodeURIComponent(tenantId)}`}>
                    进入 P6 部署
                  </Link>
                </Button>
              )}

              <div className="space-y-2 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-600">
                <div>确认文档：{state?.confirmation_path || 'phase0/tenants/<tenant>/vault/confirmation-cc.md'}</div>
                <div>P4 蓝图 hash：{shortHash(state?.intake_analysis_hash)}</div>
                <div>已签版本 hash：{shortHash(state?.confirmation_analysis_hash)}</div>
              </div>
            </div>
          </form>

          <section className="space-y-5">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionTitle
                  title="P4 蓝图摘要"
                  subtitle="这是本页真正要审批的内容。原始 markdown、hash 和 path 只是审计证据。"
                />
                {blueprint?.delivery_mode && (
                  <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-800">
                    {blueprint.delivery_mode}
                  </span>
                )}
              </div>

              {blueprint ? (
                <div className="mt-5 grid gap-5">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-sm font-semibold text-slate-950">模式判断</div>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{blueprint.delivery_mode_reason}</p>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-950">客户 workflow 拆解</h3>
                      <SummaryList items={workflowSummary} empty="尚未读取到 workflow。" />
                    </div>
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-950">候选 Skills 蓝图</h3>
                      <SummaryList items={skillSummary} empty="尚未读取到 skills 蓝图。" />
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-950">Boundary 草稿</h3>
                      <SummaryList items={blueprint.boundary_draft || []} empty="尚未读取到 Boundary 草稿。" />
                    </div>
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-950">UAT 草稿</h3>
                      <SummaryList items={blueprint.uat_criteria || []} empty="尚未读取到 UAT 草稿。" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
                  没有可审批的 P4 蓝图。请退回 P4 完成分析或保存蓝图后再审批。
                </div>
              )}
            </div>

            <details className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <summary className="cursor-pointer text-base font-semibold text-slate-950">
                审计证据与确认文档
              </summary>
              <div className="mt-4 grid gap-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-950">输入证据</h3>
                  <div className="mt-2 space-y-1 break-all text-xs leading-5 text-slate-600">
                    <div>intake：{state?.intake_raw_path || '未读取'}</div>
                    <div>P4 蓝图：{state?.intake_analysis_path || '未读取'}</div>
                    <div>intake hash：{shortHash(state?.intake_raw_hash)}</div>
                    <div>P4 hash：{shortHash(state?.intake_analysis_hash)}</div>
                  </div>
                  <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700">
                    {previewText(state?.intake_analysis_preview || state?.intake_raw_preview) || '暂无预览。'}
                  </pre>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-950">confirmation-cc.md</h3>
                  {result ? (
                    <>
                      <div className="mt-2 break-all rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        {result.path}
                      </div>
                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700">
                        {result.content}
                      </pre>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">审批后生成确认文档。</p>
                  )}
                </div>
              </div>
            </details>
          </section>
        </section>
      </div>
    </main>
  )
}
