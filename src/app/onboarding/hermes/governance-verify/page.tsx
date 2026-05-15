import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  HermesInfoCard,
  HermesPageShell,
  HermesStatusPill,
} from '@/app/onboarding/hermes/_components/hermes-placeholder-page'
import { requireHermesAdmin } from '@/app/onboarding/hermes/_lib/auth'

const governancePanels = [
  {
    code: 'H-01 Profile Setup',
    label: 'dry-run 验证 profile/identity、USER、MEMORY、skills 结构',
    href: '/onboarding/hermes/profile',
    status: '可复用',
  },
  {
    code: 'H-02 Boundary Watchdog',
    label: 'scan 检查 boundary-rules.json、drift 和违规记录',
    href: '/onboarding/hermes/boundary',
    status: '可复用',
  },
  {
    code: 'H-03 Skill Curator',
    label: 'check + snapshot + pin 验证 approved-skills.json',
    href: '/onboarding/hermes/skill-curator',
    status: '可复用',
  },
  {
    code: 'H-04 Memory Curator',
    label: 'audit 验证 4 层记忆与 tenant isolation',
    href: '/onboarding/hermes/memory',
    status: '可复用',
  },
  {
    code: 'H-05 Output Checker',
    label: '格式、敏感信息、身份一致性输出校验',
    href: '/onboarding/hermes/output',
    status: '可复用',
  },
  {
    code: 'H-06 Guardian',
    label: 'gateway-health、token 预算、profile 恢复基础检查',
    href: '/onboarding/hermes/guardian',
    status: '可复用',
  },
  {
    code: 'H-07 Cron Governance',
    label: 'approve + cost-check 验证 cron 审批和频率限制',
    href: '/onboarding/hermes/cron',
    status: '可复用',
  },
]

export default async function HermesGovernanceVerifyPage() {
  await requireHermesAdmin('/onboarding/hermes/governance-verify')
  return (
    <HermesPageShell
      title="H7 治理验证"
      description="串联现有 Hermes 运维面板逐项验证治理配置。"
    >
      <HermesInfoCard
        title="H-01 至 H-07 验证入口"
        meta={<HermesStatusPill tone="warning">等待人工运行</HermesStatusPill>}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          H7 不重复实现运维逻辑，只把 H-01~H-07 面板纳入 Hermes 构建主线，逐项跑完后进入 H8 闸门测试。
        </p>
      </HermesInfoCard>

      <section className="grid gap-4 md:grid-cols-2">
        {governancePanels.map(panel => (
          <article key={panel.code} className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{panel.code}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{panel.label}</p>
              </div>
              <HermesStatusPill tone="neutral">{panel.status}</HermesStatusPill>
            </div>
            <Button asChild variant="outline" size="sm" className="mt-5">
              <Link href={panel.href}>打开面板</Link>
            </Button>
          </article>
        ))}
      </section>
    </HermesPageShell>
  )
}
