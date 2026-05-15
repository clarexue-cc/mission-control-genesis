import { HermesPlaceholderPage } from '@/app/onboarding/hermes/_components/hermes-placeholder-page'

export default function HermesDeployPage() {
  return (
    <HermesPlaceholderPage
      title="H3 部署配置 Deploy"
      description="生成 config.yaml、harness-meta 和客户 vault 初始化配置。"
      pending="待实现 - 将对接 Hermes 配置生成和 vault 初始化逻辑"
    />
  )
}
