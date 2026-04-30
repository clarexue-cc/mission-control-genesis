'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

interface TenantSkillInventoryItem {
  tenant_id: string
  skill_name: string
  title: string
  vault_path: string
  path: string
  excerpt: string
}

interface TenantSkillInventoryResponse {
  ok: boolean
  skills: TenantSkillInventoryItem[]
  total: number
  error?: string
}

const PHASE_2_ITEMS = [
  '上传 / 审核 / 价格 / 版本 / 一键发布 待 Phase 2 实施',
  'Publish Candidate → Review → ClawHub Marketplace 上架留到 Phase 2',
  '当前阶段只允许在 Customer Onboarding P9 配置客户专属 Skill',
]

function onboardingHref(tenantId: string) {
  const params = new URLSearchParams()
  if (tenantId) params.set('tenant', tenantId)
  params.set('role', 'admin')
  return `/onboarding/customer/skills?${params.toString()}`
}

export function SkillsPanel() {
  const { activeTenant } = useMissionControl()
  const [skills, setSkills] = useState<TenantSkillInventoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadInventory() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/onboarding/customer/skills/inventory', { cache: 'no-store' })
      const body = await response.json() as TenantSkillInventoryResponse
      if (!response.ok) throw new Error(body.error || 'Failed to load tenant Skills')
      setSkills(body.skills || [])
      setTotal(body.total || 0)
    } catch (err: any) {
      setSkills([])
      setTotal(0)
      setError(err?.message || 'Failed to load tenant Skills')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInventory().catch(() => {})
  }, [])

  const tenantForCta = activeTenant?.slug || skills[0]?.tenant_id || resolveDefaultCustomerTenantId()

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <header className="border-b border-border pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Phase 2 Planning</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-foreground">ClawHub 技能广场（Phase 2 规划中）</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Skills Center 现在是未来生态规划入口；客户专属 Draft、Tenant 注入和 UAT 验证请从 Customer Onboarding P9 进入。
            </p>
          </div>
          <Button asChild size="sm">
            <Link href={onboardingHref(tenantForCta)}>进入 Customer Onboarding P9</Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        {PHASE_2_ITEMS.map(item => (
          <div key={item} className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm leading-6 text-foreground">{item}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">已 Tenant 落地的 Skills（只读）</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              跨 tenant 汇总 vault/skills/*.md，仅用于查看，不在这里配置客户 Skill。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
              {total} skills
            </span>
            <Button variant="outline" size="sm" onClick={loadInventory} disabled={loading}>
              {loading ? '刷新中' : '刷新'}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="px-4 py-6 text-sm text-destructive">{error}</div>
        ) : loading ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">正在读取 Tenant Vault Skills...</div>
        ) : skills.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">
            还没有 tenant 落地的 Skill。请先在 Customer Onboarding P9 执行 Draft 注入到 Tenant Vault。
          </div>
        ) : (
          <div className="divide-y divide-border">
            {skills.map(skill => (
              <article key={`${skill.tenant_id}:${skill.skill_name}`} className="px-4 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-sm font-semibold text-foreground">{skill.title}</h3>
                      <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {skill.tenant_id}
                      </span>
                    </div>
                    {skill.excerpt && <p className="mt-1 text-xs leading-5 text-muted-foreground">{skill.excerpt}</p>}
                    <p className="mt-2 break-all font-mono text-2xs text-muted-foreground">{skill.path}</p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={onboardingHref(skill.tenant_id)}>打开该 tenant P9</Link>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
