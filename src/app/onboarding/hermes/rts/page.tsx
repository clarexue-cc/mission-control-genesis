import {
  HermesInfoCard,
  HermesPageShell,
  HermesStatusPill,
} from '@/app/onboarding/hermes/_components/hermes-placeholder-page'
import { requireHermesAdmin } from '@/app/onboarding/hermes/_lib/auth'

const rtsItems = [
  ['RTS-01', 'Golden 100% pass', 'G-01~G-07'],
  ['RTS-02', 'Adversarial 0 违反', 'A-01~A-04 + HT-*'],
  ['RTS-03', 'Cron 连续 3 天稳定', 'HT-01'],
  ['RTS-04', 'Profile 隔离验证', 'HT-04'],
  ['RTS-05', 'Vault 写入格式正确', 'G-06'],
  ['RTS-06', 'Token 预算未超限', 'LF-04'],
  ['RTS-07', 'Guardian 健康', 'H9'],
  ['RTS-08', 'Curator 状态健康', 'HT-03'],
  ['RTS-09', '4层记忆闭环全过', 'ML-01~ML-05'],
  ['RTS-10', 'Langfuse trace 完整', 'LF-01~LF-05'],
  ['RTS-11', 'Hook 等效机制全过', 'HK-01~HK-06'],
]

export default async function HermesRtsPage() {
  await requireHermesAdmin('/onboarding/hermes/rts')
  return (
    <HermesPageShell
      title="H10 Hermes 上线"
      description="执行 Hermes Ready-to-Ship checklist。"
    >
      <HermesInfoCard
        title="Ready-to-Ship Checklist"
        meta={<HermesStatusPill tone="warning">11 项待确认</HermesStatusPill>}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          H10 只有在 H8 全过且 H9 Guardian 就绪后才允许进入交付验收。
        </p>
      </HermesInfoCard>

      <section className="rounded-lg border border-border bg-card">
        <div className="grid grid-cols-[7rem_1fr_9rem] gap-3 border-b border-border px-5 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <span>Code</span>
          <span>检查项</span>
          <span>证据来源</span>
        </div>
        {rtsItems.map(([code, label, evidence]) => (
          <div key={code} className="grid grid-cols-[7rem_1fr_9rem] gap-3 border-b border-border px-5 py-4 text-sm last:border-b-0">
            <span className="font-mono font-semibold text-primary">{code}</span>
            <span>{label}</span>
            <span className="font-mono text-muted-foreground">{evidence}</span>
          </div>
        ))}
      </section>
    </HermesPageShell>
  )
}
