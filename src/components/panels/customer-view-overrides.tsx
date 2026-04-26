'use client'

import type { CustomerVisiblePanel } from '@/lib/rbac'

interface CustomerPanelCopy {
  display_name: string
  description: string
  empty_state: string
  show_what: string[]
}

const panelCopy: Record<CustomerVisiblePanel, CustomerPanelCopy> = {
  overview: {
    display_name: '总览',
    description: '你今天的 Agent 在做什么',
    empty_state: '你的 Agent 正在待命，随时可以开始新任务。',
    show_what: ['Agent 状态灯', '今日已完成任务数', '今日使用量', '未读告警条数'],
  },
  cron: {
    display_name: '定时任务',
    description: '查看和管理 Agent 定期自动执行的任务',
    empty_state: '还没有设置定时任务。联系你的管家来添加。',
    show_what: ['任务名称', '下次执行时间', '上次执行结果', '任务开关'],
  },
  alerts: {
    display_name: '告警',
    description: '需要你知道的重要提醒',
    empty_state: '没有新告警，一切正常。',
    show_what: ['告警时间', '告警摘要', '建议操作', '是否需要你回复'],
  },
  channels: {
    display_name: '频道',
    description: '你的服务消息和专属管家联系入口',
    empty_state: '服务频道已就绪。',
    show_what: ['管家联系方式', '常见问题', '提交反馈入口', '服务通知'],
  },
}

const panelClassName = 'rounded-lg border border-border bg-card/70'

export function getCustomerPanelLabel(panel: string): string {
  return panelCopy[panel as CustomerVisiblePanel]?.display_name || '总览'
}

export function CustomerHeaderBar({ panel }: { panel: string }) {
  const copy = panelCopy[panel as CustomerVisiblePanel] || panelCopy.overview
  return (
    <header className="relative z-50 h-14 shrink-0 border-b border-border bg-card/80 px-3 backdrop-blur-sm md:px-4">
      <div className="flex h-full items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">客户视图 · {copy.display_name}</div>
          <div className="truncate text-xs text-muted-foreground">{copy.description}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200">服务在线</span>
          <span className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs text-muted-foreground">客户模式</span>
        </div>
      </div>
    </header>
  )
}

export function CustomerViewOverrides({ panel }: { panel: string }) {
  const activePanel = (panelCopy[panel as CustomerVisiblePanel] ? panel : 'overview') as CustomerVisiblePanel
  const copy = panelCopy[activePanel]

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <section className={`${panelClassName} p-5`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">{copy.display_name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
          </div>
          <span className="w-fit rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary">客户可见</span>
        </div>
      </section>

      {activePanel === 'overview' && <CustomerOverview copy={copy} />}
      {activePanel === 'cron' && <CustomerCron copy={copy} />}
      {activePanel === 'alerts' && <CustomerAlerts copy={copy} />}
      {activePanel === 'channels' && <CustomerChannels copy={copy} />}
    </div>
  )
}

function CustomerOverview({ copy }: { copy: CustomerPanelCopy }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className={`${panelClassName} p-5`}>
        <h2 className="text-sm font-semibold text-foreground">今日状态</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <CustomerMetric label="Agent 状态" value="在线" hint="Agent 正常运行中" tone="emerald" />
          <CustomerMetric label="今日完成" value="12" hint="已完成任务数" tone="cyan" />
          <CustomerMetric label="今日使用量" value="62%" hint="额度使用正常" tone="amber" />
          <CustomerMetric label="未读告警" value="0" hint="没有新告警，一切正常" tone="emerald" />
        </div>
      </section>
      <CustomerWhatIsVisible copy={copy} />
    </div>
  )
}

function CustomerCron({ copy }: { copy: CustomerPanelCopy }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className={`${panelClassName} overflow-hidden`}>
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">定时任务</h2>
        </div>
        <div className="divide-y divide-border">
          {[
            ['每日媒体情报简报', '明天 09:00', '上次正常完成', '已开启'],
            ['每周内容表现复盘', '周一 10:30', '上次正常完成', '已开启'],
          ].map(([name, nextRun, status, toggle]) => (
            <div key={name} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_160px_160px_90px]">
              <div className="font-medium text-foreground">{name}</div>
              <div className="text-sm text-muted-foreground">{nextRun}</div>
              <div className="text-sm text-emerald-200">{status}</div>
              <div className="text-sm text-primary">{toggle}</div>
            </div>
          ))}
        </div>
      </section>
      <CustomerWhatIsVisible copy={copy} />
    </div>
  )
}

function CustomerAlerts({ copy }: { copy: CustomerPanelCopy }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className={`${panelClassName} p-5`}>
        <h2 className="text-sm font-semibold text-foreground">告警</h2>
        <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-5">
          <div className="text-sm font-medium text-emerald-100">{copy.empty_state}</div>
          <p className="mt-1 text-xs text-emerald-100/75">需要你处理的提醒会显示在这里。</p>
        </div>
      </section>
      <CustomerWhatIsVisible copy={copy} />
    </div>
  )
}

function CustomerChannels({ copy }: { copy: CustomerPanelCopy }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className={`${panelClassName} p-5`}>
        <h2 className="text-sm font-semibold text-foreground">联系管家</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/70 p-4">
            <div className="text-sm font-medium text-foreground">专属管家</div>
            <div className="mt-1 text-xs text-muted-foreground">工作日 10:00-19:00 响应</div>
          </div>
          <div className="rounded-lg border border-border bg-background/70 p-4">
            <div className="text-sm font-medium text-foreground">服务反馈</div>
            <div className="mt-1 text-xs text-muted-foreground">遇到问题可以直接提交反馈。</div>
          </div>
        </div>
      </section>
      <CustomerWhatIsVisible copy={copy} />
    </div>
  )
}

function CustomerWhatIsVisible({ copy }: { copy: CustomerPanelCopy }) {
  return (
    <aside className={`${panelClassName} p-5`}>
      <h2 className="text-sm font-semibold text-foreground">当前页面展示</h2>
      <ul className="mt-3 space-y-2">
        {copy.show_what.map(item => (
          <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-lg border border-border bg-background/70 px-3 py-3 text-xs text-muted-foreground">
        {copy.empty_state}
      </div>
    </aside>
  )
}

function CustomerMetric({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'emerald' | 'cyan' | 'amber' }) {
  const toneClass = {
    emerald: 'text-emerald-200 border-emerald-500/25 bg-emerald-500/10',
    cyan: 'text-cyan-200 border-cyan-500/25 bg-cyan-500/10',
    amber: 'text-amber-200 border-amber-500/25 bg-amber-500/10',
  }[tone]
  return (
    <div className="rounded-lg border border-border bg-background/70 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-2 inline-flex rounded-md border px-2.5 py-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
    </div>
  )
}
