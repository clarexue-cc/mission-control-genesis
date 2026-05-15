import { HermesPlaceholderPage } from '@/app/onboarding/hermes/_components/hermes-placeholder-page'

export default function HermesGovernanceConfigPage() {
  return (
    <HermesPlaceholderPage
      title="H6 治理配置"
      description="配置 cron-schedule、approved-skills、boundary 和 output-checker。"
      pending="待实现 - 将对接 Hermes 治理配置生成逻辑"
    />
  )
}
