'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

interface BlueprintSkillCandidate {
  id: string
  title: string
  order: number
  workflow_stage: string
  inputs: string[]
  outputs: string[]
  handoff: string
  human_confirmation: string
  reason: string
}

interface CustomerBlueprintResponse {
  ok: boolean
  tenant_id: string
  skills_blueprint: BlueprintSkillCandidate[]
  error?: string
}

type SkillLifecycleStatus = 'Draft' | 'Tenant' | 'UAT'
type SkillDiskStatus = 'missing' | 'unchanged' | 'exists-different'

interface SkillLifecycleRecord {
  skill_id: string
  skill_name: string
  path: string
  vault_path: string
  lifecycle_status: SkillLifecycleStatus
  disk_status: SkillDiskStatus
}

interface SkillLifecycleResponse {
  ok: boolean
  tenant_id: string
  skills_dir: string
  uat_feedback_active: boolean
  skills: SkillLifecycleRecord[]
  error?: string
}

interface GenerateResponse {
  ok: boolean
  created: number
  unchanged: number
  skipped: number
  error?: string
}

const DEFAULT_TENANT_ID = resolveDefaultCustomerTenantId()

const CUSTOMER_SETUP_STEPS = [
  { label: 'P3 Intake', href: '/onboarding/customer' },
  { label: 'P4 Blueprint', href: '/onboarding/customer/analyze' },
  { label: 'P5 Approval', href: '/onboarding/customer/confirm' },
  { label: 'P6 Deploy', href: '/onboarding/customer/deploy' },
  { label: 'P7 SOUL/AGENTS', href: '/onboarding/customer/soul' },
  { label: 'P8 Boundary', href: '/boundary' },
  { label: 'P9 Skills 配置', href: '/onboarding/customer/skills', active: true },
  { label: 'P15 UAT', href: '/tasks' },
  { label: 'P16 Delivery', href: '/delivery' },
]

const statusCopy: Record<SkillLifecycleStatus, { label: string; className: string }> = {
  Draft: {
    label: 'Draft（未注入）',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  },
  Tenant: {
    label: 'Tenant（已生成 .md）',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  },
  UAT: {
    label: 'UAT 验证中（P15 反馈中）',
    className: 'border-primary/30 bg-primary/10 text-primary',
  },
}

function queryHref(baseHref: string, tenantId: string, role: string) {
  const params = new URLSearchParams()
  params.set('tenant', tenantId)
  if (role) params.set('role', role)
  return `${baseHref}?${params.toString()}`
}

function FieldList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.length > 0 ? items.map(item => (
          <span key={item} className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground">
            {item}
          </span>
        )) : (
          <span className="text-xs text-muted-foreground">待 P4 补齐</span>
        )}
      </div>
    </div>
  )
}

function SkillCard({
  skill,
  lifecycle,
}: {
  skill: BlueprintSkillCandidate
  lifecycle?: SkillLifecycleRecord
}) {
  const status = lifecycle?.lifecycle_status || 'Draft'
  const statusInfo = statusCopy[status]
  const vaultPath = lifecycle?.vault_path || `vault/skills/${skill.id}.md`
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-muted-foreground">
              #{skill.order}
            </span>
            <h2 className="break-words text-lg font-semibold text-foreground">{skill.title || skill.id}</h2>
          </div>
          <p className="mt-1 break-words text-xs text-muted-foreground">{skill.id}</p>
        </div>
        <span className={`w-fit rounded-md border px-2.5 py-1 text-xs font-medium ${statusInfo.className}`}>
          {statusInfo.label}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="text-xs font-medium text-muted-foreground">这个 Skill 是干嘛的</div>
          <p className="mt-2 text-sm leading-6 text-foreground">{skill.reason || '待 P4 补齐 reason'}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="text-xs font-medium text-muted-foreground">workflow_stage</div>
          <p className="mt-2 text-sm leading-6 text-foreground">{skill.workflow_stage || '待 P4 补齐 workflow_stage'}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <FieldList label="inputs（读什么）" items={skill.inputs || []} />
        <FieldList label="outputs（生什么）" items={skill.outputs || []} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-xs font-medium text-muted-foreground">handoff（交接到哪）</div>
          <p className="mt-2 text-sm leading-6 text-foreground">{skill.handoff || '待 P4 补齐 handoff'}</p>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground">human_confirmation（是否需人工确认）</div>
          <p className="mt-2 text-sm leading-6 text-foreground">{skill.human_confirmation || '待 P4 补齐 human_confirmation'}</p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-background px-3 py-2">
        <div className="text-xs font-medium text-muted-foreground">生成的 .md 路径</div>
        <div className="mt-1 break-all font-mono text-xs text-primary">{vaultPath}</div>
        {lifecycle?.disk_status === 'exists-different' && (
          <p className="mt-2 text-xs text-amber-200">Tenant Vault 中已有同名文件，内容与当前 P4 blueprint 不一致，已保护现有文件不覆盖。</p>
        )}
      </div>
    </article>
  )
}

export function CustomerSkillsClient({ username }: { username: string }) {
  const searchParams = useSearchParams()
  const role = searchParams.get('role') || 'admin'
  const [tenantId, setTenantId] = useState(searchParams.get('tenant') || searchParams.get('tenant_id') || DEFAULT_TENANT_ID)
  const [blueprint, setBlueprint] = useState<CustomerBlueprintResponse | null>(null)
  const [lifecycle, setLifecycle] = useState<SkillLifecycleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const activeTenantId = blueprint?.tenant_id || lifecycle?.tenant_id || tenantId
  const lifecycleBySkillId = useMemo(() => {
    const map = new Map<string, SkillLifecycleRecord>()
    lifecycle?.skills.forEach(skill => map.set(skill.skill_id, skill))
    return map
  }, [lifecycle?.skills])
  const skills = blueprint?.skills_blueprint || []
  const draftCount = lifecycle?.skills.filter(skill => skill.lifecycle_status === 'Draft').length ?? skills.length
  const tenantCount = lifecycle?.skills.filter(skill => skill.lifecycle_status === 'Tenant').length ?? 0
  const uatCount = lifecycle?.skills.filter(skill => skill.lifecycle_status === 'UAT').length ?? 0

  async function load(nextTenantId = tenantId) {
    const normalizedTenant = nextTenantId.trim()
    if (!normalizedTenant) return
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const params = new URLSearchParams({ tenant_id: normalizedTenant })
      const [blueprintResponse, lifecycleResponse] = await Promise.all([
        fetch(`/api/onboarding/customer/blueprint?${params.toString()}`, { cache: 'no-store' }),
        fetch(`/api/onboarding/customer/skills?${params.toString()}`, { cache: 'no-store' }),
      ])
      const blueprintBody = await blueprintResponse.json() as CustomerBlueprintResponse
      const lifecycleBody = await lifecycleResponse.json() as SkillLifecycleResponse
      if (!blueprintResponse.ok) throw new Error(blueprintBody.error || '未读取到 P4 Skills 蓝图')
      if (!lifecycleResponse.ok) throw new Error(lifecycleBody.error || '未读取到 P9 Skill 状态')
      setBlueprint(blueprintBody)
      setLifecycle(lifecycleBody)
      setTenantId(blueprintBody.tenant_id || normalizedTenant)
    } catch (err: any) {
      setBlueprint(null)
      setLifecycle(null)
      setError(err?.message || '读取 P9 Skills 配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(searchParams.get('tenant') || searchParams.get('tenant_id') || tenantId).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial query load, manual refresh handles later edits
  }, [])

  async function generateSkills() {
    setGenerating(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/onboarding/customer/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: activeTenantId }),
      })
      const body = await response.json() as GenerateResponse
      if (!response.ok) throw new Error(body.error || 'Draft 注入失败')
      setMessage(`已注入 Tenant Vault：新建 ${body.created}，不变 ${body.unchanged}，保护跳过 ${body.skipped}。`)
      await load(activeTenantId)
    } catch (err: any) {
      setError(err?.message || 'Draft 注入失败')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <main className="h-screen overflow-auto bg-background text-foreground">
      <div className="grid min-h-full lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-border bg-card/80 px-4 py-5 lg:border-b-0 lg:border-r">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Customer Setup</div>
          <div className="mt-2 text-sm font-semibold text-foreground">P9 Skills 配置</div>
          <nav aria-label="Customer Setup" className="mt-5 space-y-1">
            {CUSTOMER_SETUP_STEPS.map(step => (
              <Link
                key={step.label}
                href={queryHref(step.href, activeTenantId, role)}
                className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                  step.active
                    ? 'border border-primary/35 bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                }`}
                aria-current={step.active ? 'page' : undefined}
              >
                {step.label}
              </Link>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 px-5 py-6 lg:px-8">
          <header className="border-b border-border pb-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P9 / OB-S7</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-normal">Customer Onboarding Skills 配置</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  当前页只处理客户专属 Draft → Tenant 注入；Publish、Review、Marketplace 留到 Phase 2。
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_auto_auto]">
                <input
                  value={tenantId}
                  onChange={(event) => setTenantId(event.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                  aria-label="Tenant ID"
                />
                <Button variant="outline" size="sm" onClick={() => load(tenantId)} disabled={loading || generating}>
                  {loading ? '读取中' : '刷新 P4'}
                </Button>
                <Button size="sm" onClick={generateSkills} disabled={generating || loading || skills.length === 0}>
                  {generating ? '注入中' : 'Draft 注入到 Tenant Vault'}
                </Button>
              </div>
            </div>
          </header>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">Tenant</div>
              <div className="mt-1 break-all text-sm font-semibold text-foreground">{activeTenantId}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">Draft</div>
              <div className="mt-1 text-2xl font-semibold text-amber-200">{draftCount}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">Tenant</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-200">{tenantCount}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">UAT</div>
              <div className="mt-1 text-2xl font-semibold text-primary">{uatCount}</div>
            </div>
          </div>

          {message && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {message}
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="mt-5 space-y-4">
            {loading ? (
              <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                正在读取 P4 Skills 蓝图...
              </div>
            ) : skills.length === 0 && !error ? (
              <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                当前 tenant 尚未生成 P4 Skills 蓝图。
              </div>
            ) : (
              skills
                .slice()
                .sort((left, right) => left.order - right.order)
                .map(skill => (
                  <SkillCard key={skill.id} skill={skill} lifecycle={lifecycleBySkillId.get(skill.id)} />
                ))
            )}
          </div>

          <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
            <span>当前操作人：{username}</span>
            <Link href={queryHref('/skills', activeTenantId, role)} className="text-primary hover:underline">
              查看 Phase 2 ClawHub 规划占位
            </Link>
          </footer>
        </section>
      </div>
    </main>
  )
}
