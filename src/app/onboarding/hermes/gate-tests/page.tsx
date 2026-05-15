import {
  HermesInfoCard,
  HermesPageShell,
  HermesStatusPill,
} from '@/app/onboarding/hermes/_components/hermes-placeholder-page'
import { requireHermesAdmin } from '@/app/onboarding/hermes/_lib/auth'

const testGroups = [
  {
    title: 'Golden Tests（正确性）',
    code: 'G',
    items: [
      ['G-01', '竞对扫描输出公开来源与证据链接'],
      ['G-02', '热点筛选按热度、相关度、时效过滤'],
      ['G-03', '评论采集形成用户需求候选池'],
      ['G-04', '低粉爆款发现保留账号与样本证据'],
      ['G-05', '行业扫描输出月度趋势与风险提示'],
      ['G-06', '下游消费写入 Vault Agent-Shared/knowledge'],
      ['G-07', 'Bulletin 任务能消费爆款库、热点池、用户需求库'],
    ],
  },
  {
    title: 'Adversarial Tests（边界安全）',
    code: 'A',
    items: [
      ['A-01', '越权读取其他 tenant profile 被拒绝'],
      ['A-02', '数据源不可用时降级并保留错误证据'],
      ['A-03', 'Token 超限时截断和恢复策略生效'],
      ['A-04', '非公开数据请求被 boundary 拦截'],
    ],
  },
  {
    title: 'Hermes 底座专项',
    code: 'HT',
    items: [
      ['HT-01', 'Cron 连续稳定执行并保留运行日志'],
      ['HT-02', 'Learning Loop 将反馈写入 profile 记忆'],
      ['HT-03', 'Curator 治理校验 hash、pin、approval'],
      ['HT-04', 'Profile 隔离验证不串 tenant'],
      ['HT-05', '/goal 持久任务跨 session 恢复'],
      ['HT-06', 'Cache 命中率与过期策略可观测'],
      ['HT-07', 'Gateway 恢复和 failover 可观测'],
      ['HT-08', '搜索引擎降级链路可解释'],
    ],
  },
  {
    title: '4层记忆闭环',
    code: 'ML',
    items: [
      ['ML-01', 'L1 冻结记忆加载 USER/MEMORY'],
      ['ML-02', 'L2 FTS5 检索返回相关知识'],
      ['ML-03', 'L3 技能缓存命中 approved skill'],
      ['ML-04', 'L4 跨 session 恢复工作上下文'],
      ['ML-05', '层级流转产生审计记录'],
    ],
  },
  {
    title: 'Langfuse 数据闭环',
    code: 'LF',
    items: [
      ['LF-01', 'Trace 完整串起输入、工具、输出'],
      ['LF-02', '评分器适配 Hermes profile 输出'],
      ['LF-03', '人工反馈闭环写回评估数据'],
      ['LF-04', '成本追踪覆盖 token 与外部 API'],
      ['LF-05', '跨 Agent 对比支持 OC/Hermes 并列'],
    ],
  },
  {
    title: 'Hook 等效机制',
    code: 'HK',
    items: [
      ['HK-01', '输出拦截阻断敏感和越权内容'],
      ['HK-02', '上下文恢复读取 profile 与 vault'],
      ['HK-03', '进度保存支持长任务恢复'],
      ['HK-04', '日志归档落到 Vault 可见位置'],
      ['HK-05', '压缩保护保留红线与用户画像'],
      ['HK-06', '自我进化只进入审批队列'],
    ],
  },
]

export default async function HermesGateTestsPage() {
  await requireHermesAdmin('/onboarding/hermes/gate-tests')
  const total = testGroups.reduce((sum, group) => sum + group.items.length, 0)

  return (
    <HermesPageShell
      title="H8 闸门测试"
      description="运行 Golden、Adversarial 和 Hermes 专项测试。"
      maxWidth="max-w-7xl"
    >
      <HermesInfoCard
        title="6 大类测试矩阵"
        meta={<HermesStatusPill tone="warning">{total} 项待执行</HermesStatusPill>}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          任务文档标题写 38 项，明细当前列出 {total} 项；本页按明细实现，后续如补齐 3 项可直接加入矩阵。
        </p>
      </HermesInfoCard>

      <section className="grid gap-4 lg:grid-cols-2">
        {testGroups.map(group => (
          <article key={group.code} className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{group.title}</h2>
              <HermesStatusPill tone="neutral">{group.items.length} 项</HermesStatusPill>
            </div>
            <div className="grid gap-2">
              {group.items.map(([code, label]) => (
                <div key={code} className="grid grid-cols-[5.5rem_1fr] gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
                  <span className="font-mono font-semibold text-primary">{code}</span>
                  <span className="text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </HermesPageShell>
  )
}
