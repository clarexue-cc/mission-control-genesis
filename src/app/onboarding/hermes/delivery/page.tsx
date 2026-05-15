import {
  HermesInfoCard,
  HermesPageShell,
  HermesStatusPill,
} from '@/app/onboarding/hermes/_components/hermes-placeholder-page'
import { requireHermesAdmin } from '@/app/onboarding/hermes/_lib/auth'

const deliverables = [
  'Profile 包：identity/SOUL.md、USER.md、MEMORY.md、profile-vars.json',
  'Vault 包：Agent-情报搜集/ 与 Agent-Shared/knowledge 可见',
  '治理层：boundary-rules.json、cron-schedule.yaml、approved-skills.json',
  'Guardian：gateway-health、token budget、profile recovery 证据',
  'Langfuse：H8/H10 trace、成本、评分器与反馈闭环证据',
]

const uatItems = [
  'Vinson 每天能看到爆款库更新',
  'Vinson 每天能看到热点池更新',
  'Vinson 每天能看到用户需求库更新',
  '公众号 Agent 能消费 Agent-Shared/knowledge 的情报输出',
  'Clare 能在 Obsidian Vault 里直接检查交付材料',
]

export default async function HermesDeliveryPage() {
  await requireHermesAdmin('/onboarding/hermes/delivery')
  return (
    <HermesPageShell
      title="H11 验收交付"
      description="汇总 Hermes UAT、打包和交付材料。"
    >
      <HermesInfoCard
        title="交付口径"
        meta={<HermesStatusPill tone="warning">等待 H10 全过</HermesStatusPill>}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          H11 面向 Vinson/Clare 的验收，不再只看系统是否跑通，而是看爆款库、热点池、用户需求库是否持续进入 Vault 并能被下游消费。
        </p>
      </HermesInfoCard>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">交付包</h2>
          <ul className="mt-4 grid gap-3 text-sm">
            {deliverables.map(item => (
              <li key={item} className="rounded-md border border-border bg-background px-3 py-2 text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">UAT Checklist</h2>
          <ul className="mt-4 grid gap-3 text-sm">
            {uatItems.map(item => (
              <li key={item} className="rounded-md border border-border bg-background px-3 py-2 text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </article>
      </section>
    </HermesPageShell>
  )
}
