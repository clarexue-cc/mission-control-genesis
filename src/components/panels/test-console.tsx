'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { resolveCustomerTenantId, resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'

type TestSuite = 'golden' | 'adversarial' | 'cross-session' | 'drift'
type MonitorPanel = 'logs' | 'vault' | 'memory'
type RunStatus = 'idle' | 'running' | 'completed' | 'failed'
type CaseStatus = 'running' | 'passed' | 'failed'

interface StreamEvent {
  type: string
  run_id?: string
  tenant?: string
  suite?: TestSuite
  total?: number
  index?: number
  case_id?: string
  title?: string
  prompt?: string
  response?: string
  status?: string
  passed?: boolean
  failed?: number
  duration_ms?: number
  http_status?: number | null
  trace_id?: string | null
  error?: string | null
  message?: string
  stream?: string
  output_path?: string
  trace_ids?: string[]
  langfuse?: {
    enabled: boolean
    reason: string
  }
}

interface CaseRun {
  case_id: string
  title: string
  suite: string
  index: number
  prompt: string | null
  response: string | null
  status: CaseStatus
  duration_ms: number | null
  http_status: number | null
  trace_id: string | null
  error: string | null
}

interface PlanSource {
  label: string
  path: string
  absolute_path?: string
  exists: boolean
  preview?: string | null
}

interface PlanCase {
  testId: string
  title: string
  prompt: string
  expected_result?: string | null
  matched_rule?: string | null
  trigger?: string | null
  expected_behavior?: string | null
  should_not?: string | null
}

interface PlanSuite {
  id: TestSuite
  label: string
  expected: number
  case_count: number
  checkpoint: string
  objective: string
  sources: PlanSource[]
  criteria: string[]
  failure_modes: string[]
  optimization_targets: string[]
  cases: PlanCase[]
}

interface TestPlan {
  tenant: string
  template: string
  total: number
  harness_root: string
  runner_path: string
  suites: PlanSuite[]
}

const tenantOptions = [
  'wechat-mp-agent',
  'media-intel-v1',
  'tenant-tg-001',
  'tenant-luo-001-dev',
  'tenant-luo-001',
  'tenant-vinson-001',
  'tenant-lark-001',
]

const suiteButtons: Array<{ id: TestSuite; label: string; expected: string }> = [
  { id: 'golden', label: 'Golden', expected: '10' },
  { id: 'adversarial', label: 'Adversarial', expected: '25' },
  { id: 'cross-session', label: 'Cross-session', expected: '3' },
  { id: 'drift', label: 'Drift', expected: '8' },
]

const monitorLinks: Array<{ panel: MonitorPanel; label: string; detail: string }> = [
  { panel: 'logs', label: 'Logs', detail: '运行链路、gateway、hook、runner 日志。' },
  { panel: 'vault', label: 'Vault', detail: 'tenant 文件、SOUL、AGENTS、skills 出处。' },
  { panel: 'memory', label: 'Recall', detail: '跨会话记忆、召回证据和修正痕迹。' },
]

const langfuseBaseUrl = process.env.NEXT_PUBLIC_LANGFUSE_URL || 'http://192.168.1.116:3001'
const langfuseProjectId = process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID || ''
const langfuseTraceTemplate = process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE || ''

const inputClassName = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10'

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
    why: '确认 Recall 能记住偏好、纠错和上次任务。',
    pass: ['记得准', '自然应用', '不用用户重说', '保持原 skill 风格'],
    fail: ['忘记偏好', '召回错记忆', '从头问', '风格断掉'],
    fix: ['Recall 写入', 'Recall 检索', 'Recall 覆盖策略', 'SOUL memory_policy'],
  },
  drift: {
    why: '确认 P8 drift 不跑偏，也不误伤正常业务。',
    pass: ['越界会引导', '合法不误拦', '回到 CEO 助理范围', '替代方案自然'],
    fail: ['写代码也接', '投资建议也接', '正常业务被拦', '引导生硬'],
    fix: ['P8 drift_patterns', 'pattern 收窄/补强', 'guarantee/allow', 'SOUL/AGENTS 职责边界'],
  },
}

function formatMs(value: number | null) {
  if (value === null) return '-'
  if (value < 1000) return `${value}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function traceHref(traceId: string) {
  const encoded = encodeURIComponent(traceId)
  if (langfuseTraceTemplate) return langfuseTraceTemplate.replace('{trace_id}', encoded)
  if (langfuseProjectId) return `${langfuseBaseUrl.replace(/\/$/, '')}/project/${encodeURIComponent(langfuseProjectId)}/traces/${encoded}`
  return `${langfuseBaseUrl.replace(/\/$/, '')}/trace/${encoded}`
}

function monitorHref(panel: MonitorPanel, tenant: string) {
  const params = new URLSearchParams()
  if (tenant) params.set('tenant', tenant)
  const query = params.toString()
  return `/${panel}${query ? `?${query}` : ''}`
}

function statusClassName(status: CaseStatus) {
  if (status === 'passed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-300'
  return 'border-primary/30 bg-primary/10 text-primary'
}

function suiteRunSummary(suite: PlanSuite, cases: CaseRun[]) {
  const records = cases.filter(testCase => testCase.suite.toLowerCase() === suite.label.toLowerCase())
  const failed = records.filter(testCase => testCase.status === 'failed').length
  const passed = records.filter(testCase => testCase.status === 'passed').length
  if (records.length === 0) return { label: '未运行', className: 'border-border text-muted-foreground' }
  if (failed > 0) return { label: `链路失败 ${failed}`, className: 'border-red-500/30 bg-red-500/10 text-red-300' }
  return { label: `已采集 ${passed}/${records.length}`, className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' }
}

function caseDiagnosis(testCase: CaseRun) {
  if (!testCase.error) {
    return {
      reason: '链路已采集；语义是否通过需要按上方测试文件的期望行为人工判分。',
      next: '打开 Prompt/Response，对照该 suite 的判定标准记录通过、不过及优化点。',
    }
  }
  if (testCase.error.includes('docker') || testCase.error.includes('No such container')) {
    return {
      reason: '运行容器或 tenant 映射异常，runner 没有打到客户 agent。',
      next: '检查 P6 Deploy / Hermes tenant container / MC_HARNESS_ROOT 与 tenant 映射。',
    }
  }
  if (testCase.error.includes('HTTP')) {
    return {
      reason: 'agent 网关返回非 200，属于服务链路或鉴权问题。',
      next: '去 Logs 监控看 gateway / hook 日志，再修部署、token 或代理配置。',
    }
  }
  return {
    reason: 'runner 执行失败，先看 Runner 输出和 report 文件定位失败层。',
    next: '按错误归属回到 P6 部署、P8 boundary、P9 skills 或 Recall 调整。',
  }
}

function readInitialTenant() {
  if (typeof window === 'undefined') return resolveDefaultCustomerTenantId()
  return resolveCustomerTenantId(new URLSearchParams(window.location.search))
}

function sourceAbsolutePath(source: PlanSource, harnessRoot?: string | null) {
  if (source.absolute_path) return source.absolute_path
  if (!harnessRoot) return source.path
  return `${harnessRoot.replace(/\/$/, '')}/${source.path}`
}

function sourcePreview(source: PlanSource) {
  if (source.preview?.trim()) return source.preview
  return source.exists ? '这个文件存在，但当前没有可预览内容。' : '这个文件当前缺失。'
}

function directForSuite(suite: PlanSuite) {
  return suiteDirect[suite.id] || {
    why: suite.objective,
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

function caseExpectedItems(testCase: PlanCase, suite: PlanSuite) {
  const triggerPrefix = suite.id === 'golden' || suite.id === 'cross-session' ? 'Skill' : '触发'
  return [
    meaningful(testCase.expected_result) ? `结果: ${testCase.expected_result}` : null,
    meaningful(testCase.matched_rule) ? `命中: ${testCase.matched_rule}` : null,
    meaningful(testCase.trigger) ? `${triggerPrefix}: ${testCase.trigger}` : null,
    ...splitSignals(testCase.expected_behavior, suite.criteria),
  ].filter(Boolean) as string[]
}

function caseBadItems(testCase: PlanCase, suite: PlanSuite) {
  return splitSignals(testCase.should_not, suite.failure_modes)
}

function caseFixItems(testCase: PlanCase, suite: PlanSuite) {
  const trigger = `${testCase.trigger || ''} ${testCase.expected_behavior || ''}`.toLowerCase()
  const rule = meaningful(testCase.matched_rule)?.split(/[（(]/)[0].trim()
  const isPassCase = (testCase.expected_result || '').toLowerCase().includes('pass')

  if (suite.id === 'golden') {
    if (trigger.includes('news-aggregation')) return ['P9 news-aggregation/SKILL.md', '触发词', '输出格式', 'P7 AGENTS routing']
    if (trigger.includes('socratic-discussion')) return ['P9 socratic-discussion/SKILL.md', '反问风格', '多轮连续性', 'P7 SOUL/AGENTS']
    if (trigger.includes('course-ppt-builder')) return ['P9 course-ppt-builder/SKILL.md', '页数结构', '输出契约', 'P7 routing']
    return ['P9 对应 skill', '触发条件', '输出契约', 'P7 SOUL/AGENTS']
  }

  if (suite.id === 'adversarial') return ['P8 boundary-rules.json', rule || '对应 rule', 'pattern', 'action / response_template']
  if (suite.id === 'cross-session') return ['Recall memory 写入', 'Recall 检索', 'Recall 覆盖策略', '对应 skill 输出']
  if (suite.id === 'drift') {
    if (isPassCase) return ['P8 drift_patterns', rule || '对应 drift rule', '收窄 pattern', '加入 allow/guarantee']
    return ['P8 drift_patterns', rule || '对应 drift rule', '补强 pattern', 'SOUL/AGENTS 职责边界']
  }

  return suite.optimization_targets
}

function SignalList({ items, tone = 'neutral' }: { items: string[]; tone?: 'good' | 'bad' | 'edit' | 'neutral' }) {
  const dot = tone === 'good' ? 'bg-emerald-500' : tone === 'bad' ? 'bg-red-500' : tone === 'edit' ? 'bg-amber-500' : 'bg-muted-foreground'
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2 text-xs leading-5 text-foreground">
          <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
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

function PlanCaseCell({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="min-h-[132px] border-border bg-card/45 p-4 lg:border-l first:lg:border-l-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function SuiteWorkspace({
  suite,
  harnessRoot,
  copiedPath,
  onCopyPath,
}: {
  suite: PlanSuite
  harnessRoot: string
  copiedPath: string | null
  onCopyPath: (absolutePath: string) => void
}) {
  const displayName = suitePlainName[suite.id] || suite.label
  const accent = suiteAccent[suite.id] || suiteAccent.golden
  const direct = directForSuite(suite)

  return (
    <article className={`min-w-0 rounded-lg border border-border border-l-4 bg-background/45 p-5 shadow-sm ${accent.ring}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
            <h3 className="text-2xl font-semibold leading-tight text-foreground">{displayName}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${accent.tint}`}>{accent.label}</span>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">{suite.checkpoint}</span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">一句话：{direct.why}</p>
        </div>
        <span className="rounded-md border border-border bg-card/70 px-2.5 py-1 font-mono text-xs text-muted-foreground">
          {suite.case_count}/{suite.expected} cases
        </span>
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
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <DirectBlock label="PASS" items={direct.pass} tone="good" />
            <DirectBlock label="FAIL" items={direct.fail} tone="bad" />
            <DirectBlock label="FIX" items={direct.fix} tone="edit" />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <DirectBlock label="原始判定" items={suite.criteria} tone="good" />
            <DirectBlock label="不过通常因为什么" items={suite.failure_modes} tone="bad" />
            <DirectBlock label="下一步优化" items={suite.optimization_targets} tone="edit" />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card/35 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-base font-semibold text-foreground">测试题</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">每题四格：题目 / 期望 / 失败 / 修改。</p>
            </div>
            <span className="rounded-md border border-border bg-background/70 px-2 py-1 font-mono text-xs text-muted-foreground">{suite.case_count} 条</span>
          </div>
          <div className="mt-3 max-h-[520px] overflow-y-auto pr-1">
            <div className="space-y-3">
              {suite.cases.map(testCase => (
                <div key={testCase.testId} className="overflow-hidden rounded-md border border-border bg-background/65">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/55 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-border bg-card/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{testCase.testId}</span>
                      <span className="text-sm font-semibold text-foreground">{testCase.title}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{displayName}</span>
                  </div>
                  <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.05fr)_minmax(0,0.95fr)_minmax(0,1fr)]">
                    <PlanCaseCell label="题目">
                      <p className="text-sm leading-6 text-foreground">{testCase.prompt}</p>
                    </PlanCaseCell>
                    <PlanCaseCell label="期望">
                      <SignalList items={caseExpectedItems(testCase, suite)} tone="good" />
                    </PlanCaseCell>
                    <PlanCaseCell label="失败">
                      <SignalList items={caseBadItems(testCase, suite)} tone="bad" />
                    </PlanCaseCell>
                    <PlanCaseCell label="修改">
                      <SignalList items={caseFixItems(testCase, suite)} tone="edit" />
                    </PlanCaseCell>
                  </div>
                </div>
              ))}
            </div>
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
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {suite.sources.map(source => {
              const absolutePath = sourceAbsolutePath(source, harnessRoot)
              return (
                <div key={source.path} className="rounded-md border border-border bg-card/55 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">{source.label}</div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground" title={source.path}>{source.path}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${source.exists ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-red-500/25 bg-red-500/10 text-red-300'}`}>
                      {source.exists ? '可查看' : '缺失'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" size="xs" className="h-7 px-2 text-[11px]">
                      <a href={`file://${absolutePath}`} target="_blank" rel="noreferrer">打开文件</a>
                    </Button>
                    <Button type="button" variant="outline" size="xs" className="h-7 px-2 text-[11px]" onClick={() => onCopyPath(absolutePath)}>
                      {copiedPath === absolutePath ? '已复制' : '复制路径'}
                    </Button>
                  </div>
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 font-mono text-xs leading-6 text-muted-foreground">
                    {sourcePreview(source)}
                  </pre>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </article>
  )
}

function upsertCase(cases: CaseRun[], next: CaseRun) {
  const index = cases.findIndex(item => item.case_id === next.case_id)
  if (index < 0) return [...cases, next].sort((left, right) => left.index - right.index)
  return cases.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item)
}

export function TestConsolePanel() {
  const [tenant, setTenant] = useState(readInitialTenant)
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [runningSuite, setRunningSuite] = useState<TestSuite | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [runTotal, setRunTotal] = useState(0)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [cases, setCases] = useState<CaseRun[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [traceIds, setTraceIds] = useState<string[]>([])
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testPlan, setTestPlan] = useState<TestPlan | null>(null)
  const [planStatus, setPlanStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [planError, setPlanError] = useState<string | null>(null)
  const [activeSuiteId, setActiveSuiteId] = useState<TestSuite | null>(null)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const passCount = useMemo(() => cases.filter(testCase => testCase.status === 'passed').length, [cases])
  const failCount = useMemo(() => cases.filter(testCase => testCase.status === 'failed').length, [cases])
  const completedCount = passCount + failCount
  const totalCount = runTotal || cases.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const planCaseTotal = testPlan?.suites.reduce((sum, suite) => sum + suite.case_count, 0) ?? 0
  const activeSuite = testPlan?.suites.find(suite => suite.id === activeSuiteId) || testPlan?.suites[0] || null
  const availableTenantOptions = useMemo(() => {
    const options = [tenant, testPlan?.tenant, ...tenantOptions].filter(Boolean) as string[]
    return Array.from(new Set(options))
  }, [tenant, testPlan?.tenant])
  const runtimeTarget = `docker exec ${tenant}`
  const runtimeIssue = cases.find(testCase =>
    testCase.error?.includes('docker')
    || testCase.error?.includes('No such container')
  )?.error || null

  const appendLog = useCallback((line: string) => {
    setLogs(current => [...current.slice(-79), line])
  }, [])

  const copySourcePath = useCallback(async (absolutePath: string) => {
    try {
      await navigator.clipboard.writeText(absolutePath)
      setCopiedPath(absolutePath)
    } catch {
      setCopiedPath(null)
    }
  }, [])

  const applyEvent = useCallback((event: StreamEvent) => {
    if (event.run_id) setRunId(event.run_id)
    if (event.output_path) setOutputPath(event.output_path)
    if (Array.isArray(event.trace_ids)) setTraceIds(event.trace_ids)

    if (event.type === 'run_started') {
      setRunTotal(Number(event.total) || 0)
      setRunStatus('running')
      appendLog(`loaded ${event.total || 0} cases`)
      return
    }

    if (event.type === 'case_started' && event.case_id) {
      setCases(current => upsertCase(current, {
        case_id: event.case_id || '',
        title: event.title || event.case_id || '',
        suite: String(event.suite || runningSuite || ''),
        index: Number(event.index) || current.length + 1,
        prompt: null,
        response: null,
        status: 'running',
        duration_ms: null,
        http_status: null,
        trace_id: null,
        error: null,
      }))
      return
    }

    if (event.type === 'case_finished' && event.case_id) {
      setCases(current => upsertCase(current, {
        case_id: event.case_id || '',
        title: event.title || event.case_id || '',
        suite: String(event.suite || runningSuite || ''),
        index: Number(event.index) || current.length + 1,
        prompt: event.prompt || null,
        response: event.response || null,
        status: event.passed ? 'passed' : 'failed',
        duration_ms: typeof event.duration_ms === 'number' ? event.duration_ms : null,
        http_status: typeof event.http_status === 'number' ? event.http_status : null,
        trace_id: event.trace_id || null,
        error: event.error || null,
      }))
      return
    }

    if (event.type === 'run_finished') {
      setRunTotal(Number(event.total) || totalCount)
      setRunStatus(Number(event.failed) > 0 ? 'failed' : 'completed')
      return
    }

    if (event.type === 'process_closed') {
      setRunStatus(event.status === 'completed' ? 'completed' : 'failed')
      return
    }

    if (event.type === 'run_error') {
      setRunStatus('failed')
      setError(event.error || 'Runner failed')
      return
    }

    if (event.type === 'log' && event.message) {
      appendLog(event.message)
    }
  }, [appendLog, runningSuite, totalCount])

  const runSuite = useCallback(async (suite: TestSuite) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunStatus('running')
    setRunningSuite(suite)
    setRunId(null)
    setRunTotal(0)
    setOutputPath(null)
    setCases([])
    setLogs([])
    setTraceIds([])
    setSelectedCaseId(null)
    setError(null)

    try {
      const response = await fetch('/api/harness/run-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant, suite }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || `Request failed with ${response.status}`)
      }
      if (!response.body) throw new Error('Response stream unavailable')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          applyEvent(JSON.parse(line) as StreamEvent)
        }
      }

      buffer += decoder.decode()
      if (buffer.trim()) applyEvent(JSON.parse(buffer) as StreamEvent)
    } catch (runError: any) {
      if (runError?.name === 'AbortError') return
      setRunStatus('failed')
      setError(runError?.message || 'Failed to start test run')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunningSuite(null)
    }
  }, [applyEvent, tenant])

  useEffect(() => {
    const controller = new AbortController()
    setPlanStatus('loading')
    setPlanError(null)

    fetch(`/api/harness/test-plan?tenant=${encodeURIComponent(tenant)}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error || `Request failed with ${response.status}`)
        setTestPlan(body as TestPlan)
        setPlanStatus('ready')
      })
      .catch((planLoadError: any) => {
        if (planLoadError?.name === 'AbortError') return
        setTestPlan(null)
        setPlanStatus('failed')
        setPlanError(planLoadError?.message || 'Failed to load test plan')
      })

    return () => controller.abort()
  }, [tenant])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card/70 p-5 shadow-sm xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">P10 Test Console</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border px-2.5 py-1">run: {runId || '-'}</span>
            <span className="rounded-md border border-border px-2.5 py-1">status: {runStatus}</span>
            <span className="rounded-md border border-border px-2.5 py-1">traces: {traceIds.length}</span>
          </div>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-[minmax(180px,260px)_1fr] xl:w-auto xl:min-w-[680px]">
          <label className="min-w-0">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tenant</span>
            <select
              className={inputClassName}
              value={tenant}
              onChange={(event) => {
                setTenant(event.target.value)
                setActiveSuiteId(null)
              }}
              disabled={runStatus === 'running'}
            >
              {availableTenantOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>

          <div className="min-w-0">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suite</span>
            <div className="grid gap-2 sm:grid-cols-4">
              {suiteButtons.map(button => (
                <Button
                  key={button.id}
                  variant={runningSuite === button.id ? 'default' : 'outline'}
                  onClick={() => runSuite(button.id)}
                  disabled={runStatus === 'running'}
                  className="h-10 justify-between px-3"
                >
                  <span>{button.label}</span>
                  <span className="text-xs opacity-70">{button.expected}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Harness Test Plan</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {planStatus === 'loading' && 'Loading harness test plan...'}
              {planStatus === 'failed' && `Harness test plan unavailable: ${planError}`}
              {planStatus === 'ready' && `template=${testPlan?.template} / cases=${planCaseTotal} / tenant=${testPlan?.tenant}`}
            </p>
          </div>
          <span className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary">
            P10 consumes plan
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
          <div className="min-w-0 rounded-lg border border-border bg-background/45 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Harness root</div>
            <div className="mt-1 truncate font-mono text-xs text-foreground" title={testPlan?.harness_root || ''}>{testPlan?.harness_root || '-'}</div>
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-background/45 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Harness runner</div>
            <div className="mt-1 truncate font-mono text-xs text-foreground" title={testPlan?.runner_path || ''}>{testPlan?.runner_path || '-'}</div>
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-background/45 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Runtime target</div>
            <div className="mt-1 truncate font-mono text-xs text-foreground" title={runtimeTarget}>{runtimeTarget}</div>
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-background/45 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Report output</div>
            <div className="mt-1 truncate font-mono text-xs text-foreground" title={outputPath || ''}>{outputPath || 'created after run'}</div>
          </div>
        </div>

        {runtimeIssue && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-200">
            Runtime gap: {runtimeIssue}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">相关监控入口</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Logs / Vault / Recall 已移到左侧监控目录；P10 在这里保留当前 tenant 的直达入口。
            </p>
          </div>
          <span className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
            tenant={tenant}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {monitorLinks.map(link => (
            <a
              key={link.panel}
              href={monitorHref(link.panel, tenant)}
              className="group rounded-lg border border-border bg-background/45 p-3 transition hover:border-primary/45 hover:bg-primary/10"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">查看 {link.label}</span>
                <span className="text-xs text-primary opacity-80 transition group-hover:translate-x-0.5">Open</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{link.detail}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">测试维度与出处</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {planStatus === 'loading' && '正在从 harness 读取当前 tenant 的测试计划。'}
              {planStatus === 'failed' && `测试计划读取失败：${planError}`}
              {planStatus === 'ready' && `tenant=${testPlan?.tenant} / template=${testPlan?.template} / cases=${planCaseTotal}`}
            </p>
          </div>
          <span className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
            自动结果=链路采集；语义通过=按出处人工判分
          </span>
        </div>

        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Test suites</div>
          <h3 className="mt-1 text-lg font-semibold text-foreground">四套测试方向</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            左边选方向，右边直接看：为什么、通过、不过、改哪。
          </p>
        </div>

        {planStatus !== 'ready' || !testPlan || !activeSuite ? (
          <div className="mt-4 rounded-lg border border-border bg-background/45 p-4 text-sm text-muted-foreground">
            {planStatus === 'failed' ? '测试计划读取失败，无法展示工作区。' : 'Loading test plan workspace...'}
          </div>
        ) : (
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <nav className="rounded-lg border border-border bg-background/45 p-2" aria-label="P10 test suites">
              <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">测试方向</div>
              <div className="space-y-2">
                {testPlan.suites.map(suite => {
                  const displayName = suitePlainName[suite.id] || suite.label
                  const accent = suiteAccent[suite.id] || suiteAccent.golden
                  const selected = activeSuite.id === suite.id
                  const summary = suiteRunSummary(suite, cases)

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
                          <div className="mt-2 text-xs leading-5 text-muted-foreground">{suite.checkpoint}</div>
                          <div className="mt-2 text-[11px] text-muted-foreground">{summary.label}</div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </nav>

            <SuiteWorkspace
              suite={activeSuite}
              harnessRoot={testPlan.harness_root}
              copiedPath={copiedPath}
              onCopyPath={copySourcePath}
            />
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card/70 p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border px-2.5 py-1">total: {totalCount}</span>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">pass: {passCount}</span>
            <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-300">fail: {failCount}</span>
            {outputPath && <span className="max-w-full truncate rounded-md border border-border px-2.5 py-1">report: {outputPath}</span>}
          </div>
          <span className="text-xs font-medium text-muted-foreground">{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </section>

      <div className="grid min-h-[58vh] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
        <section className="rounded-lg border border-border bg-card/70 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Cases</h2>
            <span className="text-xs text-muted-foreground">{completedCount} / {totalCount || 0}</span>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Case</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">HTTP</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background/40">
                {cases.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      No run selected.
                    </td>
                  </tr>
                )}
                {cases.map(testCase => {
                  const isSelected = selectedCaseId === testCase.case_id

                  return (
                    <Fragment key={testCase.case_id}>
                      <tr
                        className={`cursor-pointer align-top transition hover:bg-secondary/30 ${isSelected ? 'bg-secondary/30' : ''}`}
                        onClick={() => setSelectedCaseId(current => current === testCase.case_id ? null : testCase.case_id)}
                      >
                        <td className="px-3 py-3">
                          <div className="font-medium text-foreground">{testCase.case_id}</div>
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{testCase.title}</div>
                          {testCase.error && <div className="mt-2 text-xs text-red-300">{testCase.error}</div>}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-md border px-2 py-1 text-xs ${statusClassName(testCase.status)}`}>
                            {testCase.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{testCase.http_status ?? '-'}</td>
                        <td className="px-3 py-3 text-muted-foreground">{formatMs(testCase.duration_ms)}</td>
                        <td className="px-3 py-3">
                          {testCase.trace_id ? (
                            <a
                              href={traceHref(testCase.trace_id)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                            >
                              {testCase.trace_id.slice(0, 12)}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                      {isSelected && (
                        <tr className="bg-background/70">
                          <td colSpan={5} className="px-3 pb-4">
                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="min-w-0">
                                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prompt</div>
                                <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background/80 p-3 whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
                                  {testCase.prompt || 'Waiting for prompt...'}
                                </pre>
                              </div>
                              <div className="min-w-0">
                                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Response</div>
                                <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background/80 p-3 whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
                                  {testCase.response || testCase.error || 'Waiting for response...'}
                                </pre>
                              </div>
                            </div>
                            <div className="mt-3 rounded-lg border border-border bg-background/80 p-3 text-xs leading-5">
                              <div className="font-semibold uppercase tracking-wide text-muted-foreground">结果分析 / 下一步</div>
                              <div className="mt-2 text-foreground">原因：{caseDiagnosis(testCase).reason}</div>
                              <div className="mt-1 text-muted-foreground">下一步：{caseDiagnosis(testCase).next}</div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card/70 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Runner</h2>
            <span className="text-xs text-muted-foreground">{logs.length}</span>
          </div>
          <pre className="h-[calc(58vh-3.25rem)] min-h-[320px] overflow-auto rounded-lg border border-border bg-background/80 p-3 text-xs leading-5 text-muted-foreground">
            {logs.length ? logs.join('\n') : 'No runner output.'}
          </pre>
        </section>
      </div>
    </div>
  )
}
