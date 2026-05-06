'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CustomerVisiblePanel } from '@/lib/rbac'
import { CustomerUatTasksPanel } from '@/components/panels/customer-uat-tasks-panel'

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
    display_name: '渠道管理',
    description: '管理 Agent 向你发消息的方式',
    empty_state: '还没有绑定任何消息渠道，联系你的管家来设置。',
    show_what: ['渠道开关（飞书 / Telegram / 邮件）', '绑定状态', '消息预览', '测试发送按钮'],
  },
  tasks: {
    display_name: 'UAT 任务',
    description: '查看验收任务并提交反馈',
    empty_state: '暂无需要验收的任务。',
    show_what: ['任务标题', '任务描述', '提交 input', '反馈表', '评分与提交时间'],
  },
  delivery: {
    display_name: '交付验收',
    description: '查看当前交付清单和验收状态',
    empty_state: '暂无待验收交付项。',
    show_what: ['交付阶段', '验收结果', '阻塞事项', '下一步动作'],
  },
}

type CustomerChannelId = 'lark' | 'telegram' | 'email'

interface CustomerChannel {
  id: CustomerChannelId
  name: string
  description: string
  bound: boolean
  defaultEnabled: boolean
  preview: string
}

const customerChannels: CustomerChannel[] = [
  {
    id: 'lark',
    name: '飞书',
    description: '通过飞书机器人接收消息',
    bound: true,
    defaultEnabled: true,
    preview: '今日日报已生成，重点内容已同步到你的飞书。',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: '通过 Telegram Bot 接收消息',
    bound: false,
    defaultEnabled: false,
    preview: '绑定 Telegram 后会在这里预览最新消息。',
  },
  {
    id: 'email',
    name: '邮件',
    description: '通过邮件接收通知',
    bound: true,
    defaultEnabled: true,
    preview: '告警与定时任务摘要会同步发送到已绑定邮箱。',
  },
]

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
      {activePanel === 'tasks' && <CustomerUatTasksPanel />}
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
  const [enabledChannels, setEnabledChannels] = useState<Record<CustomerChannelId, boolean>>(() => (
    customerChannels.reduce((acc, channel) => {
      acc[channel.id] = channel.bound && channel.defaultEnabled
      return acc
    }, {} as Record<CustomerChannelId, boolean>)
  ))
  const [testResult, setTestResult] = useState<string | null>(null)
  const allOff = customerChannels.every(channel => !enabledChannels[channel.id])

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <section className={`${panelClassName} p-5`}>
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-foreground">消息渠道</h2>
            <p className="text-xs text-muted-foreground">选择 Agent 通知你的方式，可同时开启多个渠道</p>
          </div>
          <div className="mt-4 grid gap-3">
            {customerChannels.map(channel => {
              const enabled = enabledChannels[channel.id]
              return (
                <div key={channel.id} className="rounded-lg border border-border bg-background/70 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-foreground">{channel.name}</h3>
                        <span className={`rounded-md border px-2 py-0.5 text-2xs ${
                          channel.bound
                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                            : 'border-amber-500/25 bg-amber-500/10 text-amber-200'
                        }`}>
                          {channel.bound ? '已绑定' : '未绑定'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{channel.description}</p>
                      {!channel.bound && (
                        <p className="mt-2 text-xs text-amber-200">未绑定 {channel.name}，联系管家开通。</p>
                      )}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${enabled ? '关闭' : '开启'} ${channel.name}`}
                      disabled={!channel.bound}
                      onClick={() => {
                        setEnabledChannels(current => ({ ...current, [channel.id]: !current[channel.id] }))
                        setTestResult(null)
                      }}
                      className={`inline-flex h-8 w-16 shrink-0 items-center rounded-full border px-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        enabled
                          ? 'border-primary/40 bg-primary/30 justify-end'
                          : 'border-border bg-secondary/60 justify-start'
                      }`}
                    >
                      <span className="h-6 w-6 rounded-full bg-foreground shadow-sm" />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-xs ${enabled ? 'text-primary' : 'text-muted-foreground'}`}>
                      {enabled ? '已开启' : '已关闭'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!channel.bound || !enabled}
                      onClick={() => setTestResult(`测试消息已发送，请检查 ${channel.name}`)}
                    >
                      发送测试消息
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          {allOff && (
            <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
              当前所有渠道均已关闭，你将无法收到 Agent 的主动通知。
            </div>
          )}
        </section>

        <section className={`${panelClassName} p-5`}>
          <h2 className="text-sm font-semibold text-foreground">消息预览</h2>
          <div className="mt-4 rounded-lg border border-border bg-background/70 p-4">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>AI 助手</span>
              <span>刚刚</span>
            </div>
            <p className="mt-2 text-sm text-foreground">
              {customerChannels.find(channel => enabledChannels[channel.id])?.preview || '暂无消息记录'}
            </p>
          </div>
          {testResult && (
            <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-3 text-xs text-emerald-100">
              {testResult}
            </div>
          )}
        </section>
      </div>
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
