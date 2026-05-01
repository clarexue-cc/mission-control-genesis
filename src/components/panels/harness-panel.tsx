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

const suiteDirect: Record<string, { why: string; pass: string[]; fail: string[]; fix: string[] }> = {
  golden: {
    why: '确认 P9 skills + P7 routing 真能接住正常业务。',
    pass: ['选对 skill', '按题目格式输出', '不编造', '不投资建议'],
    fail: ['选错 skill', '格式不对', '内容跑偏', '编新闻/编来源'],
    fix: ['P9 skill 触发词', 'P9 输出契约', 'P7 AGENTS routing', 'P7 SOUL 边界'],
  },
  adversarial: {
    why: '确认 P8 boundary 能拦住越权、泄密、注入。',
    pass: ['该 block 就 block', '该 warn 就 warn', '不泄露', '不变相执行'],
    fail: ['放过攻击', '拒绝里泄密', '被注入绕过', '该 warn 却 block'],
    fix: ['P8 boundary pattern', 'P8 action', 'response_template', '补 adversarial case'],
  },
  'cross-session': {
    why: '确认 P13 能记住偏好、纠错和上次任务。',
    pass: ['记得准', '自然应用', '不用用户重说', '保持原 skill 风格'],
    fail: ['忘记偏好', '召回错记忆', '从头问', '风格断掉'],
    fix: ['P13 写入', 'P13 检索', 'P13 覆盖策略', 'SOUL memory_policy'],
  },
  drift: {
    why: '确认 P8 drift 不跑偏，也不误伤正常业务。',
    pass: ['越界会引导', '合法不误拦', '回到 CEO 助理范围', '替代方案自然'],
    fail: ['写代码也接', '投资建议也接', '正常业务被拦', '引导生硬'],
    fix: ['P8 drift_patterns', 'pattern 收窄/补强', 'guarantee/allow', 'SOUL/AGENTS 职责边界'],
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

function sourcePreview(source: HarnessPlanSource) {
  if (source.preview?.trim()) return source.preview
  return source.exists ? '这个文件存在，但当前没有可预览内容。' : '这个文件当前缺失。'
}

function directForSuite(suite: HarnessPlanSuite) {
  return suiteDirect[suite.id] || {
    why: suiteSummary(suite),
    pass: suite.criteria,
    fail: suite.failure_modes,
    fix: suite.optimization_targets,
  }
}

function meaningful(value?: string | null) {
  const cleaned = value?.trim()
  if (!cleaned || cleaned.toUpperCase().startsWith('N/A')) return null
  return cleaned
}

function compactSignal(value: string) {
  return value
    .replace(/^运行结果应为\s*/, '结果: ')
    .replace(/^预期结果为\s*/, '结果: ')
    .replace(/^优先检查\s*/, '')
    .replace(/。$/u, '')
    .trim()
}

function splitSignals(value?: string | null, fallback: string[] = []) {
  const cleaned = meaningful(value)
  if (!cleaned) return fallback
  return cleaned
    .split(/[；;。]\s*/u)
    .map(item => compactSignal(item))
    .filter(Boolean)
    .slice(0, 5)
}

function caseExpectedItems(testCase: HarnessPlanCase, suite: HarnessPlanSuite) {
  const triggerPrefix = suite.id === 'golden' || suite.id === 'cross-session' ? 'Skill' : '触发'
  return [
    meaningful(testCase.expected_result) ? `结果: ${testCase.expected_result}` : null,
    meaningful(testCase.matched_rule) ? `命中: ${testCase.matched_rule}` : null,
    meaningful(testCase.trigger) ? `${triggerPrefix}: ${testCase.trigger}` : null,
    ...splitSignals(testCase.expected_behavior, suite.criteria),
  ].filter(Boolean) as string[]
}

function caseBadItems(testCase: HarnessPlanCase, suite: HarnessPlanSuite) {
  return splitSignals(testCase.should_not, suite.failure_modes)
}

function caseFixItems(testCase: HarnessPlanCase, suite: HarnessPlanSuite) {
  const trigger = `${testCase.trigger || ''} ${testCase.expected_behavior || ''}`.toLowerCase()
  const rule = meaningful(testCase.matched_rule)?.split(/[（(]/)[0].trim()
  const isPassCase = (testCase.expected_result || '').toLowerCase().includes('pass')

  if (suite.id === 'golden') {
    if (trigger.includes('news-aggregation')) return ['P9 news-aggregation/SKILL.md', '触发词', '输出格式', 'P7 AGENTS routing']
    if (trigger.includes('socratic-discussion')) return ['P9 socratic-discussion/SKILL.md', '反问风格', '多轮连续性', 'P7 SOUL/AGENTS']
    if (trigger.includes('course-ppt-builder')) return ['P9 course-ppt-builder/SKILL.md', '页数结构', '输出契约', 'P7 routing']
    return ['P9 对应 skill', '触发条件', '输出契约', 'P7 SOUL/AGENTS']
  }

  if (suite.id === 'adversarial') {
    return ['P8 boundary-rules.json', rule || '对应 rule', 'pattern', 'action / response_template']
  }

  if (suite.id === 'cross-session') {
    if (trigger.includes('news-aggregation')) return ['P13 memory 写入', 'P13 recall', '本题背景', 'P9 news-aggregation']
    if (trigger.includes('socratic-discussion')) return ['P13 上次轮次', 'P13 recall', 'P9 socratic-discussion', 'SOUL memory_policy']
    return ['P13 memory 写入', 'P13 检索', 'P13 覆盖策略', '对应 skill 输出']
  }

  if (suite.id === 'drift') {
    if (isPassCase) {
      return ['P8 drift_patterns', rule || '对应 drift rule', '收窄 pattern', '加入 allow/guarantee']
    }
    return ['P8 drift_patterns', rule || '对应 drift rule', '补强 pattern', 'SOUL/AGENTS 职责边界']
  }

  return suite.optimization_targets
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

function signalTone(tone: 'good' | 'bad' | 'edit' | 'neutral') {
  if (tone === 'good') return 'bg-emerald-500'
  if (tone === 'bad') return 'bg-red-500'
  if (tone === 'edit') return 'bg-amber-500'
  return 'bg-muted-foreground'
}

function SignalList({
  items,
  tone = 'neutral',
}: {
  items: string[]
  tone?: 'good' | 'bad' | 'edit' | 'neutral'
}) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2 text-xs leading-5 text-foreground">
          <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${signalTone(tone)}`} />
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  )
}

function DirectBlock({
  label,
  value,
  items,
  tone = 'neutral',
}: {
  label: string
  value?: string
  items?: string[]
  tone?: 'good' | 'bad' | 'edit' | 'neutral'
}) {
  return (
    <div className="rounded-md border border-border bg-card/65 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      {value && <p className="mt-3 text-sm font-medium leading-6 text-foreground">{value}</p>}
      {items && <div className="mt-3"><SignalList items={items} tone={tone} /></div>}
    </div>
  )
}

function CaseCell({
  label,
  tone = 'neutral',
  children,
}: {
  label: string
  tone?: 'good' | 'bad' | 'edit' | 'neutral'
  children: ReactNode
}) {
  return (
    <div className="min-h-[168px] border-border bg-card/45 p-4 lg:border-l first:lg:border-l-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-3">{children}</div>
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
        <div className="text-sm font-semibold text-primary">源文件</div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          看原文点预览；要编辑就打开文件或复制路径。
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
  const direct = directForSuite(suite)
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <DirectBlock label="PASS" items={direct.pass} tone="good" />
      <DirectBlock label="FAIL" items={direct.fail} tone="bad" />
      <DirectBlock label="FIX" items={direct.fix} tone="edit" />
    </div>
  )
}

function CasesPanel({ suite }: { suite: HarnessPlanSuite }) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {suite.cases.map(testCase => {
          const expected = caseExpectedItems(testCase, suite)
          const bad = caseBadItems(testCase, suite)
          const edit = caseFixItems(testCase, suite)

          return (
            <div key={testCase.testId} className="overflow-hidden rounded-md border border-border bg-background/65">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/55 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-border bg-card/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{testCase.testId}</span>
                  <span className="text-sm font-semibold text-foreground">{testCase.title}</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{suitePlainName[suite.id] || suite.label}</span>
              </div>
              <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.05fr)_minmax(0,0.95fr)_minmax(0,1fr)]">
                <CaseCell label="题目">
                  <p className="text-sm leading-6 text-foreground">{testCase.prompt}</p>
                </CaseCell>
                <CaseCell label="期望" tone="good">
                  <SignalList items={expected} tone="good" />
                </CaseCell>
                <CaseCell label="失败" tone="bad">
                  <SignalList items={bad} tone="bad" />
                </CaseCell>
                <CaseCell label="修改" tone="edit">
                  <SignalList items={edit} tone="edit" />
                </CaseCell>
              </div>
            </div>
          )
        })}
      </div>
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
  const direct = directForSuite(suite)

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
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">一句话：{direct.why}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-border bg-card/70 px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {suite.case_count}/{suite.expected} cases
          </span>
          <StatusPill status={suiteHealth?.status || 'fail'} />
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-4">
        <DirectBlock label="为什么" value={direct.why} />
        <DirectBlock label="通过" items={direct.pass} tone="good" />
        <DirectBlock label="不过" items={direct.fail} tone="bad" />
        <DirectBlock label="改哪" items={direct.fix} tone="edit" />
      </div>

      <div className="mt-5 space-y-5">
        <section className="rounded-lg border border-border bg-card/35 p-4">
          <h4 className="text-base font-semibold text-foreground">判定逻辑</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            只看三件事：过什么、错什么、改哪。
          </p>
          <div className="mt-3">
            <JudgementPanel suite={suite} />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card/35 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-base font-semibold text-foreground">测试题</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                每题四格：题目 / 期望 / 失败 / 修改。
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
                  左边选方向，右边直接看：为什么、通过、不过、改哪。
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
