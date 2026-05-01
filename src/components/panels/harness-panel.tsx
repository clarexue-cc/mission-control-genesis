'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

type HealthStatus = 'ready' | 'warning' | 'blocked'
type CheckStatus = 'pass' | 'warn' | 'fail'
type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

interface HarnessHealthCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  action?: string
}

interface HarnessHealthSuite {
  id: string
  label: string
  expected: number
  actual: number
  status: CheckStatus
  file: string
}

interface HarnessRuntimeContainer {
  name: string
  status: CheckStatus
  detail: string
  running: boolean
  health: string | null
}

interface HarnessHealth {
  status: HealthStatus
  tenant: string
  template: string | null
  total_cases: number
  harness_root: string | null
  runner_path: string | null
  runtime_target: string
  container: HarnessRuntimeContainer | null
  suites: HarnessHealthSuite[]
  checks: HarnessHealthCheck[]
  latest_report?: {
    path: string
    updated_at: string
  } | null
}

interface HarnessPlanSource {
  label: string
  path: string
  absolute_path?: string
  exists: boolean
  preview?: string | null
}

interface HarnessPlanCase {
  testId: string
  title: string
  prompt: string
  expected_result?: string | null
  matched_rule?: string | null
  trigger?: string | null
  expected_behavior?: string | null
  should_not?: string | null
}

interface HarnessPlanSuite {
  id: string
  label: string
  expected: number
  case_count: number
  checkpoint: string
  objective: string
  sources: HarnessPlanSource[]
  criteria: string[]
  failure_modes: string[]
  optimization_targets: string[]
  cases: HarnessPlanCase[]
}

interface HarnessPlan {
  tenant: string
  template: string
  total: number
  harness_root: string
  runner_path: string
  suites: HarnessPlanSuite[]
}

const panelClassName = 'rounded-lg border border-border bg-card/80 shadow-sm'

const suitePlainName: Record<string, string> = {
  golden: '正常能力',
  adversarial: '边界攻击',
  'cross-session': '跨会话记忆',
  drift: '角色漂移',
}

const suiteAccent: Record<string, { ring: string; tint: string; dot: string; label: string }> = {
  golden: {
    ring: 'border-l-emerald-500/70',
    tint: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
    dot: 'bg-emerald-400',
    label: '业务能力',
  },
  adversarial: {
    ring: 'border-l-red-500/70',
    tint: 'bg-red-500/10 text-red-300 border-red-500/25',
    dot: 'bg-red-400',
    label: '安全边界',
  },
  'cross-session': {
    ring: 'border-l-sky-500/70',
    tint: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
    dot: 'bg-sky-400',
    label: '记忆召回',
  },
  drift: {
    ring: 'border-l-violet-500/70',
    tint: 'bg-violet-500/10 text-violet-300 border-violet-500/25',
    dot: 'bg-violet-400',
    label: '角色稳定',
  },
}

const suiteOrigin: Record<string, { phase: string; source: string; editFocus: string }> = {
  golden: {
    phase: 'P7 SOUL/AGENTS + P9 Skills',
    source: '角色设定、运行指令、skills 输出契约和 Golden 题库一起决定正常能力测试。',
    editFocus: '能力跑偏时先看 P9 skills，再看 P7 SOUL / AGENTS routing。',
  },
  adversarial: {
    phase: 'P8 Boundary',
    source: 'boundary-rules.json 和 Adversarial 题库一起决定越权、泄密、注入类测试。',
    editFocus: '拦不住时改 P8 boundary pattern / action / response_template。',
  },
  'cross-session': {
    phase: 'P13 Recall',
    source: 'SOUL memory_policy、AGENTS 运行指令和 Cross-session 题库一起决定召回测试。',
    editFocus: '记不住或召错时改 P13 memory 写入、检索、覆盖策略。',
  },
  drift: {
    phase: 'P8 Drift',
    source: 'drift_patterns、SOUL/AGENTS 职责边界和 Drift 题库一起决定角色漂移测试。',
    editFocus: '跑偏或误伤时改 P8 drift pattern，并补 SOUL / AGENTS 职责描述。',
  },
}

function toneClassName(tone: Tone) {
  if (tone === 'success') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (tone === 'warning') return 'border-amber-500/40 bg-amber-500/12 text-amber-200'
  if (tone === 'danger') return 'border-red-500/35 bg-red-500/10 text-red-300'
  if (tone === 'info') return 'border-primary/30 bg-primary/10 text-primary'
  return 'border-border bg-background/70 text-muted-foreground'
}

function statusMeta(status: HealthStatus | CheckStatus) {
  if (status === 'ready' || status === 'pass') {
    return {
      label: 'OK',
      icon: '✓',
      tone: 'success' as Tone,
      dot: 'bg-emerald-400',
    }
  }
  if (status === 'warning' || status === 'warn') {
    return {
      label: '注意',
      icon: '!',
      tone: 'warning' as Tone,
      dot: 'bg-amber-300',
    }
  }
  return {
    label: '阻塞',
    icon: '×',
    tone: 'danger' as Tone,
    dot: 'bg-red-400',
  }
}

function sourceAbsolutePath(source: HarnessPlanSource, harnessRoot?: string | null) {
  if (source.absolute_path) return source.absolute_path
  if (!harnessRoot) return source.path
  return `${harnessRoot.replace(/\/$/, '')}/${source.path}`
}

function suiteSummary(suite: HarnessPlanSuite) {
  if (suite.id === 'golden') return '测客户 agent 正常能不能把该会的事做好。'
  if (suite.id === 'adversarial') return '测越权、泄密、注入、伪装等坏请求能不能拦住。'
  if (suite.id === 'cross-session') return '测换一个会话后，偏好、纠错和任务续接能不能召回。'
  if (suite.id === 'drift') return '测 agent 会不会跑偏角色，或误伤正常业务请求。'
  return suite.objective
}

function compactPath(source?: HarnessPlanSource) {
  if (!source) return '-'
  const parts = source.path.split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

function sourceSummary(sources: HarnessPlanSource[]) {
  return sources
    .map(source => `${source.label}: ${compactPath(source)}`)
    .join(' · ')
}

function sourcePreview(source: HarnessPlanSource) {
  if (source.preview?.trim()) return source.preview
  return source.exists ? '这个文件存在，但当前没有可预览内容。' : '这个文件当前缺失。'
}

function meaningful(value?: string | null) {
  const cleaned = value?.trim()
  if (!cleaned || cleaned.toUpperCase().startsWith('N/A')) return null
  return cleaned
}

function caseExpectedText(testCase: HarnessPlanCase, suite: HarnessPlanSuite) {
  const triggerPrefix = suite.id === 'golden' || suite.id === 'cross-session' ? '应使用' : '应触发'
  const lines = [
    meaningful(testCase.expected_result) ? `运行结果应为 ${testCase.expected_result}。` : null,
    meaningful(testCase.matched_rule) ? `应命中：${testCase.matched_rule}。` : null,
    meaningful(testCase.trigger) ? `${triggerPrefix}：${testCase.trigger}。` : null,
    meaningful(testCase.expected_behavior) || suite.criteria[0] || '符合本题测试文档里的预期行为。',
  ].filter(Boolean)

  return lines.join('\n')
}

function caseBadText(testCase: HarnessPlanCase, suite: HarnessPlanSuite) {
  return meaningful(testCase.should_not) || suite.failure_modes[0] || '输出偏离本题预期，或没有命中该命中的规则/能力。'
}

function caseFixHint(testCase: HarnessPlanCase, suite: HarnessPlanSuite) {
  const trigger = `${testCase.trigger || ''} ${testCase.expected_behavior || ''}`.toLowerCase()
  const rule = meaningful(testCase.matched_rule)?.split(/[（(]/)[0].trim()
  const isPassCase = (testCase.expected_result || '').toLowerCase().includes('pass')

  if (suite.id === 'golden') {
    if (trigger.includes('news-aggregation')) return '优先检查 P9 news-aggregation/SKILL.md 的触发条件和输出格式；如果没有选到这个 skill，再看 P7 AGENTS.base.md 的 routing。'
    if (trigger.includes('socratic-discussion')) return '优先检查 P9 socratic-discussion/SKILL.md 的反问风格；如果多轮跑偏，再看 P7 SOUL.md 和 AGENTS.base.md。'
    if (trigger.includes('course-ppt-builder')) return '优先检查 P9 course-ppt-builder/SKILL.md 的页数、结构和输出契约；如果 skill 没被选中，再看 P7 routing。'
    return '优先检查 P9 对应 skill 的触发条件和输出契约；如果能力选择不对，再看 P7 SOUL/AGENTS。'
  }

  if (suite.id === 'adversarial') {
    return `优先检查 P8 boundary-rules.json${rule ? ` 里的 ${rule}` : ' 的对应 forbidden rule'}：pattern 是否覆盖这题、action 是否正确、response_template 是否会泄露或变相执行。`
  }

  if (suite.id === 'cross-session') {
    if (trigger.includes('news-aggregation')) return '优先检查 P13 memory 是否写入并召回了本题背景；召回正确但输出不对时，再看 P9 news-aggregation/SKILL.md。'
    if (trigger.includes('socratic-discussion')) return '优先检查 P13 memory 是否恢复上次讨论轮次；能恢复但风格不对时，再看 P9 socratic-discussion/SKILL.md。'
    return '优先检查 P13 memory 写入、检索、覆盖策略；召回成功后再看对应 skill 的输出。'
  }

  if (suite.id === 'drift') {
    if (isPassCase) {
      return `如果这题被误拦，先收窄 P8 drift_patterns${rule ? ` 的 ${rule}` : ''}，把业务语境加入 guarantee/allow 说明。`
    }
    return `如果这题没触发引导，先补强 P8 drift_patterns${rule ? ` 的 ${rule}` : ''}，再检查 SOUL/AGENTS 是否把 CEO 助理职责边界说清楚。`
  }

  return suite.optimization_targets[0] || '回到本题对应源文件调整。'
}

function MetricCard({
  label,
  value,
  detail,
  meta,
}: {
  label: string
  value: ReactNode
  detail: ReactNode
  meta?: ReturnType<typeof statusMeta>
}) {
  return (
    <section className={`${panelClassName} min-h-[132px] p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
        {meta && (
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${toneClassName(meta.tone)}`}>
            {meta.icon}
          </span>
        )}
      </div>
      <div className="mt-4 text-2xl font-semibold leading-tight text-foreground">{value}</div>
      <div className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</div>
    </section>
  )
}

function StatusPill({ status }: { status: HealthStatus | CheckStatus }) {
  const meta = statusMeta(status)
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${toneClassName(meta.tone)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

function CollapsibleBlock({
  title,
  summary,
  children,
  defaultOpen = false,
  bodyClassName = 'px-3 py-3',
}: {
  title: string
  summary?: string
  children: ReactNode
  defaultOpen?: boolean
  bodyClassName?: string
}) {
  return (
    <details className="group rounded-md border border-border bg-background/55" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-secondary/40">
        <span className="min-w-0">
          <span>{title}</span>
          {summary && <span className="ml-2 text-xs font-normal text-muted-foreground">{summary}</span>}
        </span>
        <span className="text-xs text-muted-foreground transition group-open:rotate-90">›</span>
      </summary>
      <div className={`border-t border-border ${bodyClassName}`}>
        {children}
      </div>
    </details>
  )
}

function MiniDefinition({
  label,
  tone,
  children,
}: {
  label: string
  tone: 'good' | 'bad' | 'edit' | 'neutral'
  children: ReactNode
}) {
  const toneClass = tone === 'good'
    ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300'
    : tone === 'bad'
      ? 'border-red-500/25 bg-red-500/[0.06] text-red-300'
      : tone === 'edit'
        ? 'border-primary/25 bg-primary/[0.06] text-primary'
        : 'border-border bg-card/55 text-muted-foreground'

  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{children}</div>
    </div>
  )
}

function SourceFilesPanel({
  sources,
  harnessRoot,
  copiedPath,
  onCopyPath,
}: {
  sources: HarnessPlanSource[]
  harnessRoot: string
  copiedPath: string | null
  onCopyPath: (absolutePath: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-primary/20 bg-primary/[0.06] p-4">
        <div className="text-sm font-semibold text-primary">源文件查看入口</div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          这里直接看测试题、角色、运行指令和 skill 文件的预览；要进本地文件就点打开或复制路径。
        </p>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {sources.map(source => {
          const absolutePath = sourceAbsolutePath(source, harnessRoot)
          return (
            <div key={source.path} className="rounded-md border border-border bg-card/55 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{source.label}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{compactPath(source)}</div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${source.exists ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-red-500/25 bg-red-500/10 text-red-300'}`}>
                  {source.exists ? '可查看' : '缺失'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="xs" className="h-7 px-2 text-[11px]">
                  <a href={`file://${absolutePath}`} target="_blank" rel="noreferrer">打开文件</a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onCopyPath(absolutePath)}
                >
                  {copiedPath === absolutePath ? '已复制' : '复制路径'}
                </Button>
              </div>
              <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 font-mono text-xs leading-6 text-muted-foreground">
                {sourcePreview(source)}
              </pre>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function JudgementPanel({ suite }: { suite: HarnessPlanSuite }) {
  return (
    <div className="space-y-3">
      <MiniDefinition label="通过长什么样" tone="good">
        <ul className="space-y-1">
          {suite.criteria.map(item => <li key={item}>{item}</li>)}
        </ul>
      </MiniDefinition>
      <MiniDefinition label="不通过长什么样" tone="bad">
        <ul className="space-y-1">
          {suite.failure_modes.map(item => <li key={item}>{item}</li>)}
        </ul>
      </MiniDefinition>
      <MiniDefinition label="整套失败先改哪" tone="edit">
        <ul className="space-y-1">
          {suite.optimization_targets.map(item => <li key={item}>{item}</li>)}
        </ul>
      </MiniDefinition>
    </div>
  )
}

function CasesPanel({ suite }: { suite: HarnessPlanSuite }) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {suite.cases.map(testCase => {
          const expected = caseExpectedText(testCase, suite)
          const bad = caseBadText(testCase, suite)
          const edit = caseFixHint(testCase, suite)

          return (
            <div key={testCase.testId} className="rounded-md border border-border bg-background/65 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-border bg-card/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{testCase.testId}</span>
                  <span className="text-sm font-semibold text-foreground">{testCase.title}</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{suitePlainName[suite.id] || suite.label}</span>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.05fr)_minmax(0,0.95fr)_minmax(0,1fr)]">
                <div className="rounded-md border border-border bg-card/50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">测试输入</div>
                  <p className="mt-1 text-sm leading-6 text-foreground">{testCase.prompt}</p>
                </div>
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">本题期望</div>
                  <p className="mt-1 whitespace-pre-line text-xs leading-5 text-muted-foreground">{expected}</p>
                </div>
                <div className="rounded-md border border-red-500/20 bg-red-500/[0.05] p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-300">不合格表现</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{bad}</p>
                </div>
                <div className="rounded-md border border-primary/20 bg-primary/[0.05] p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">失败后先看</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{edit}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InfoTile({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="rounded-md border border-border bg-card/55 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm leading-6 text-foreground">{children}</div>
    </div>
  )
}

function SuiteDetailPanel({
  suite,
  suiteHealth,
  harnessRoot,
  copiedPath,
  onCopyPath,
}: {
  suite: HarnessPlanSuite
  suiteHealth?: HarnessHealthSuite
  harnessRoot: string
  copiedPath: string | null
  onCopyPath: (absolutePath: string) => void
}) {
  const displayName = suitePlainName[suite.id] || suite.label
  const accent = suiteAccent[suite.id] || suiteAccent.golden
  const origin = suiteOrigin[suite.id] || {
    phase: suite.checkpoint,
    source: suite.objective,
    editFocus: suite.optimization_targets[0] || '按失败原因回到对应配置修改。',
  }
  const suiteMeta = statusMeta(suiteHealth?.status || 'fail')

  return (
    <article className={`min-w-0 rounded-lg border border-border border-l-4 bg-background/45 p-5 shadow-sm ${accent.ring}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
            <h3 className="text-2xl font-semibold leading-tight text-foreground">{displayName}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${accent.tint}`}>{accent.label}</span>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">{origin.phase}</span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{suiteSummary(suite)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-border bg-card/70 px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {suite.case_count}/{suite.expected} cases
          </span>
          <StatusPill status={suiteHealth?.status || 'fail'} />
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-4">
        <InfoTile label="为什么测这套">{origin.source}</InfoTile>
        <InfoTile label="测什么">{suiteSummary(suite)}</InfoTile>
        <InfoTile label="失败后先看">
          <p>{origin.editFocus}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{sourceSummary(suite.sources)}</p>
        </InfoTile>
        <InfoTile label="当前状态">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${toneClassName(suiteMeta.tone)}`}>
            {suiteMeta.icon} {suiteMeta.label}
          </span>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {suiteHealth ? `${suiteHealth.actual}/${suiteHealth.expected} cases parsed` : 'health check missing'}
          </p>
        </InfoTile>
      </div>

      <div className="mt-5 space-y-5">
        <section className="rounded-lg border border-border bg-card/35 p-4">
          <h4 className="text-base font-semibold text-foreground">整套题如何判通过</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            这里是这套题的总规则；每一道题自己的期望和失败原因在下面逐条展开。
          </p>
          <div className="mt-3">
            <JudgementPanel suite={suite} />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card/35 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-base font-semibold text-foreground">题目</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                每一条都按这个题目本身显示：输入是什么、应该看到什么、哪样算失败、失败后先改哪里。
              </p>
            </div>
            <span className="rounded-md border border-border bg-background/70 px-2 py-1 font-mono text-xs text-muted-foreground">{suite.case_count} 条</span>
          </div>
          <div className="mt-3 max-h-[620px] overflow-y-auto pr-1">
            <CasesPanel suite={suite} />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card/35 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-base font-semibold text-foreground">源文件</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">可直接展开查看预览，也可打开文件或复制路径。</p>
            </div>
            <span className="rounded-md border border-border bg-background/70 px-2 py-1 font-mono text-xs text-muted-foreground">{suite.sources.length} 个</span>
          </div>
          <div className="mt-3">
            <SourceFilesPanel
              sources={suite.sources}
              harnessRoot={harnessRoot}
              copiedPath={copiedPath}
              onCopyPath={onCopyPath}
            />
          </div>
        </section>
      </div>
    </article>
  )
}

export function HarnessPanel() {
  const [health, setHealth] = useState<HarnessHealth | null>(null)
  const [plan, setPlan] = useState<HarnessPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [activeSuiteId, setActiveSuiteId] = useState<string | null>(null)

  const copySourcePath = useCallback(async (absolutePath: string) => {
    try {
      await navigator.clipboard.writeText(absolutePath)
      setCopiedPath(absolutePath)
    } catch {
      setCopiedPath(null)
    }
  }, [])

  const fetchHarness = useCallback(async () => {
    setRefreshing(true)
    try {
      const params = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
      const tenant = params?.get('tenant') || params?.get('tenant_id') || resolveDefaultCustomerTenantId()
      const [healthResponse, planResponse] = await Promise.all([
        fetch(`/api/harness/health?tenant=${encodeURIComponent(tenant)}`),
        fetch(`/api/harness/test-plan?tenant=${encodeURIComponent(tenant)}`),
      ])

      const healthBody = await healthResponse.json().catch(() => null)
      if (!healthResponse.ok) throw new Error(healthBody?.error || `HTTP ${healthResponse.status}`)
      setHealth(healthBody as HarnessHealth)
      setError(null)

      const planBody = await planResponse.json().catch(() => null)
      if (!planResponse.ok) {
        setPlan(null)
        setPlanError(planBody?.error || `HTTP ${planResponse.status}`)
      } else {
        setPlan(planBody as HarnessPlan)
        setPlanError(null)
      }
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load harness')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchHarness()
    const timer = setInterval(() => {
      void fetchHarness()
    }, 15000)
    return () => clearInterval(timer)
  }, [fetchHarness])

  const suitePassCount = useMemo(() => health?.suites.filter(suite => suite.status === 'pass').length ?? 0, [health])
  const runtimeStatus = health?.container?.status || 'fail'
  const runtimeMeta = statusMeta(runtimeStatus)

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <header className={`${panelClassName} overflow-hidden`}>
        <div className="border-b border-border bg-secondary/25 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">Harness 工作台</h1>
                {health && <StatusPill status={health.status} />}
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                先看 harness 能不能用，再看四套测试方向；题目和修改入口都放在对应卡片里。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {health && (
                <span className="rounded-md border border-border bg-background/70 px-2.5 py-1 font-mono text-xs text-muted-foreground">
                  {health.tenant}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={fetchHarness} disabled={refreshing}>
                {refreshing ? '刷新中...' : '刷新'}
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="m-4 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </header>

      {!health ? (
        <section className={`${panelClassName} p-5 text-sm text-muted-foreground`}>
          Loading harness...
        </section>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <MetricCard
              label="当前结论"
              value={runtimeStatus === 'pass' ? '可以跑 P10' : '先修运行环境'}
              detail={runtimeStatus === 'pass'
                ? 'runner 能打到当前 tenant。'
                : health.container?.detail || 'runtime container 未就绪。'}
              meta={runtimeMeta}
            />

            <MetricCard
              label="题库状态"
              value={(
                <span className="flex items-end gap-2">
                  <span className="font-mono text-4xl tabular-nums">{health.total_cases}</span>
                  <span className="pb-1 text-sm font-normal text-muted-foreground">cases</span>
                </span>
              )}
              detail={`${suitePassCount}/${health.suites.length} suites OK`}
            />

            <MetricCard
              label="下一步"
              value={runtimeStatus === 'pass' ? '去 P10 跑测试' : '修 ceo-assistant-v1 container'}
              detail={runtimeStatus === 'pass'
                ? '再回 P10 看通过、失败和反馈。'
                : '题库已就绪，阻塞点不是测试题。'}
            />
          </section>

          <section className={`${panelClassName} p-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Test suites</div>
                <h2 className="mt-1 text-lg font-semibold text-foreground">四套测试方向</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  每张卡先说测什么、改哪里、现在状态；需要深看再展开题目和修改入口。
                </p>
              </div>
              {planError && (
                <span className="rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1 text-xs text-red-200">
                  {planError}
                </span>
              )}
            </div>

            {!plan ? (
              <div className="mt-4 rounded-lg border border-border bg-background/45 p-4 text-sm text-muted-foreground">
                Loading test plan...
              </div>
            ) : (() => {
              const activeSuite = plan.suites.find(suite => suite.id === activeSuiteId) || plan.suites[0]
              return (
                <div className="mt-4 grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                  <nav className="rounded-lg border border-border bg-background/45 p-2" aria-label="Harness test suites">
                    <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">测试方向</div>
                    <div className="space-y-2">
                      {plan.suites.map(suite => {
                        const suiteHealth = health.suites.find(item => item.id === suite.id)
                        const displayName = suitePlainName[suite.id] || suite.label
                        const accent = suiteAccent[suite.id] || suiteAccent.golden
                        const origin = suiteOrigin[suite.id] || { phase: suite.checkpoint, source: suite.objective, editFocus: suite.optimization_targets[0] || '按失败原因回到对应配置修改。' }
                        const selected = activeSuite.id === suite.id

                        return (
                          <button
                            key={suite.id}
                            type="button"
                            onClick={() => setActiveSuiteId(suite.id)}
                            className={`w-full rounded-md border p-3 text-left transition ${selected ? 'border-primary/40 bg-primary/10 shadow-sm' : 'border-border bg-card/45 hover:bg-card/70'}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
                                  <span className="text-sm font-semibold text-foreground">{displayName}</span>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${accent.tint}`}>{accent.label}</span>
                                  <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{suite.case_count}/{suite.expected}</span>
                                </div>
                                <div className="mt-2 text-xs leading-5 text-muted-foreground">{origin.phase}</div>
                              </div>
                              <StatusPill status={suiteHealth?.status || 'fail'} />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </nav>

                  {activeSuite && (
                    <SuiteDetailPanel
                      suite={activeSuite}
                      suiteHealth={health.suites.find(item => item.id === activeSuite.id)}
                      harnessRoot={plan.harness_root}
                      copiedPath={copiedPath}
                      onCopyPath={copySourcePath}
                    />
                  )}
                </div>
              )
            })()}
          </section>

          <CollapsibleBlock
            title="高级诊断"
            summary="运行检查 / 底层路径"
            bodyClassName="p-0"
          >
            <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,0.64fr)_minmax(0,0.36fr)]">
              <div className="overflow-hidden rounded-md border border-border bg-card/45">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">运行检查</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    给开发排查 harness 自身是否 ready；Clare 看测试策略时不用先看这里。
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-secondary/50 uppercase tracking-[0.14em] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">项</th>
                        <th className="px-3 py-2">状态</th>
                        <th className="px-3 py-2">结论</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-background/20">
                      {health.checks.map(check => (
                        <tr key={check.id} className="align-top">
                          <td className="px-3 py-2 font-medium text-foreground">{check.label}</td>
                          <td className="px-3 py-2">
                            <StatusPill status={check.status} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="break-words text-muted-foreground">{check.detail}</div>
                            {check.action && <div className="mt-1 text-foreground">{check.action}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-md border border-border bg-card/45 p-4">
                <h2 className="text-sm font-semibold text-foreground">底层路径</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  给开发定位本地 harness root、runner 和 latest report，平时不用读。
                </p>
                <div className="mt-4 space-y-3 text-xs">
                  <div>
                    <div className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">Harness root</div>
                    <div className="mt-1 break-all rounded-md border border-border bg-background/70 px-2 py-1.5 font-mono text-foreground">{health.harness_root || '-'}</div>
                  </div>
                  <div>
                    <div className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">Runner</div>
                    <div className="mt-1 break-all rounded-md border border-border bg-background/70 px-2 py-1.5 font-mono text-foreground">{health.runner_path || '-'}</div>
                  </div>
                  <div>
                    <div className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">Latest report</div>
                    <div className="mt-1 break-all rounded-md border border-border bg-background/70 px-2 py-1.5 font-mono text-foreground">{health.latest_report?.path || '-'}</div>
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleBlock>
        </>
      )}
    </div>
  )
}
