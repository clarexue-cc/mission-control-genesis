'use client'

import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import loader from '@monaco-editor/loader'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'
import {
  parseBoundaryRulesRaw,
  stringifyBoundaryRules,
  validateBoundaryRules,
  type BoundaryRules,
  type DriftRule,
  type ForbiddenRule,
} from '@/lib/harness-boundary-schema'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
})

type RuleTab = 'forbidden' | 'drift'
type ToastKind = 'success' | 'error' | 'info'
type BoundaryMode = 'full' | 'mock-fallback'
type ReloadStrategy = 'reload' | 'restart' | 'mock-fallback'

interface BoundaryRulesResponse {
  tenant: string
  tenants: string[]
  path: string
  exists: boolean
  hash: string | null
  content: string
  rules: BoundaryRules | null
  parse_error: string | null
  writable: boolean
  reload_strategy: ReloadStrategy
  mode?: BoundaryMode
  note?: string
  error?: string
}

interface ReloadResponse {
  success?: boolean
  hash?: string
  method?: ReloadStrategy
  mode?: BoundaryMode
  latency_ms?: number
  note?: string
  error?: string
}

interface CustomerBlueprintResponse {
  tenant_id: string
  boundary_rules: BoundaryRules
}

interface ToastState {
  kind: ToastKind
  title: string
  detail: string
}

const tenantOptions = ['ceo-assistant-v1', 'media-intel-v1', 'web3-research-v1']
const defaultTenantId = resolveDefaultCustomerTenantId()
const inputClassName = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10'
const panelClassName = 'rounded-lg border border-border bg-card/70'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error')
}

function displayMode(mode: BoundaryMode) {
  return mode === 'mock-fallback' ? '本机模拟模式' : '正式 OpenClaw 模式'
}

function displayReloadStrategy(strategy: ReloadStrategy) {
  if (strategy === 'mock-fallback') return '写入本机测试文件'
  if (strategy === 'restart') return '保存后重启生效'
  return '保存后 reload 生效'
}

function displaySeverity(value: string) {
  const normalized = value.toLowerCase()
  if (normalized === 'critical') return '最高风险'
  if (normalized === 'high') return '高风险'
  if (normalized === 'medium') return '中风险'
  if (normalized === 'low') return '低风险'
  return value || '未设置'
}

function displayAction(value: string) {
  const normalized = value.toLowerCase()
  if (normalized === 'block') return '直接拦截'
  if (normalized === 'warn') return '提醒确认'
  if (normalized === 'review') return '转人工确认'
  return value || '未设置'
}

function forbiddenReason(rule: ForbiddenRule) {
  const text = `${rule.label} ${(rule.patterns || []).join(' ')} ${rule.pattern} ${rule.response_template}`
  if (/公开来源|推测|事实|商业判断|人物动态/.test(text)) {
    return '保证后续内容可追溯，避免把传闻、推测或未核实判断写成事实。'
  }
  if (/人物评价|商业建议|争议|证据|不确定/.test(text)) {
    return '人物评价、商业建议和争议内容容易被误读，必须保留证据和不确定性。'
  }
  if (/确认|发布|PPT|课程稿|邮件|社媒|对外/.test(text)) {
    return '对外内容会影响客户口径和声誉，必须先经过 CEO / Clare 确认。'
  }
  if (/未授权|私密|账号|付费|内部文件|受限/.test(text)) {
    return '避免越权获取或使用受限材料，保护客户隐私、版权和账号安全。'
  }
  return '这是 P4 边界草稿沉淀出的红线，用来防止后续 Agent 产物偏离客户要求。'
}

function ruleSignal(rule: ForbiddenRule | DriftRule) {
  const maybePatterns = (rule as Partial<ForbiddenRule>).patterns
  const patterns = Array.isArray(maybePatterns) ? maybePatterns : []
  const preview = patterns.filter(Boolean).slice(0, 3)
  if (preview.length > 0) {
    return `${preview.join('；')}${patterns.length > preview.length ? `；另 ${patterns.length - preview.length} 条` : ''}`
  }
  return rule.pattern ? '使用已保存的正则/关键词规则判断' : '保存后由后续流程按 boundary.yaml 检查'
}

function forbiddenGuarantee(rule: ForbiddenRule) {
  return `保存进 boundary.yaml 后，后续流程会按这些线索检查请求；命中时系统会“${displayAction(rule.action)}”，并返回固定提示。`
}

function driftGuarantee(rule: DriftRule) {
  return `保存进 boundary.yaml 后，后续验证会按这条偏离线索检查 Agent 输出，避免内容跑偏。`
}

export function BoundaryEditorPanel() {
  const { activeTenant } = useMissionControl()
  const searchParams = useSearchParams()
  const requestedTenant = searchParams.get('tenant') || searchParams.get('tenant_id')
  const urlTenant = requestedTenant && tenantOptions.includes(requestedTenant) ? requestedTenant : ''
  const [tenant, setTenant] = useState(urlTenant || activeTenant?.slug || defaultTenantId)
  const [availableTenants, setAvailableTenants] = useState(tenantOptions)
  const [activeTab, setActiveTab] = useState<RuleTab>('forbidden')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [monacoReady, setMonacoReady] = useState(false)
  const [rules, setRules] = useState<BoundaryRules | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [savedValue, setSavedValue] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filePath, setFilePath] = useState('')
  const [hash, setHash] = useState<string | null>(null)
  const [writable, setWritable] = useState(false)
  const [exists, setExists] = useState(false)
  const [reloadStrategy, setReloadStrategy] = useState<ReloadStrategy>('reload')
  const [mode, setMode] = useState<BoundaryMode>('full')
  const [modeNote, setModeNote] = useState('')
  const [p4BoundaryDraft, setP4BoundaryDraft] = useState<BoundaryRules | null>(null)
  const [p4BoundaryMessage, setP4BoundaryMessage] = useState('')
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dirty = editorValue !== savedValue
  const forbiddenCount = rules?.forbidden_patterns.length || 0
  const driftCount = rules?.drift_patterns.length || 0

  const showToast = useCallback((nextToast: ToastState) => {
    setToast(nextToast)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 4500)
  }, [])

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    let cancelled = false

    import('monaco-editor')
      .then((monaco) => {
        if (cancelled) return
        loader.config({ monaco })
        setMonacoReady(true)
      })
      .catch(() => {
        if (!cancelled) setMonacoReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (urlTenant) {
      setTenant(urlTenant)
      return
    }
    setTenant(activeTenant?.slug || defaultTenantId)
  }, [activeTenant?.slug, urlTenant])

  const applyRules = useCallback((nextRules: BoundaryRules) => {
    setRules(nextRules)
    const nextValue = stringifyBoundaryRules(nextRules)
    setEditorValue(nextValue)
    try {
      validateBoundaryRules(nextRules)
      setValidationError(null)
    } catch (error) {
      setValidationError(errorMessage(error))
    }
  }, [])

  const applyP4BoundaryDraft = useCallback(() => {
    if (!p4BoundaryDraft) return
    applyRules(p4BoundaryDraft)
    setP4BoundaryMessage(`已载入 ${tenant} 的 P4 边界草稿`)
  }, [applyRules, p4BoundaryDraft, tenant])

  const loadRules = useCallback(async (nextTenant: string) => {
    setLoading(true)
    setLoadError(null)
    setValidationError(null)

    try {
      const response = await fetch(`/api/harness/boundary-rules?tenant=${encodeURIComponent(nextTenant)}`, { cache: 'no-store' })
      const body = await response.json() as BoundaryRulesResponse
      if (!response.ok) throw new Error(body.error || '边界规则加载失败')

      setAvailableTenants(body.tenants?.length ? body.tenants : tenantOptions)
      setFilePath(body.path)
      setHash(body.hash)
      setWritable(body.writable)
      setExists(body.exists)
      setReloadStrategy(body.reload_strategy)
      setMode(body.mode || 'full')
      setModeNote(body.note || '')
      setEditorValue(body.content)
      setSavedValue(body.content)
      setP4BoundaryDraft(null)
      setP4BoundaryMessage('')

      if (body.rules) {
        setRules(body.rules)
        setValidationError(body.parse_error)
      } else {
        setRules(null)
        setValidationError(body.parse_error || '边界规则 JSON 格式不正确')
      }

      try {
        const blueprintResponse = await fetch(`/api/onboarding/customer/blueprint?tenant_id=${encodeURIComponent(nextTenant)}`, { cache: 'no-store' })
        const blueprintBody = await blueprintResponse.json()
        if (blueprintResponse.ok && blueprintBody?.boundary_rules) {
          const blueprint = blueprintBody as CustomerBlueprintResponse
          setP4BoundaryDraft(blueprint.boundary_rules)
          setP4BoundaryMessage(`已载入 ${blueprint.tenant_id} 的 P4 边界草稿`)
          if (!body.exists && blueprint.boundary_rules.forbidden_patterns?.length) {
            const draftContent = stringifyBoundaryRules(blueprint.boundary_rules)
            setRules(blueprint.boundary_rules)
            setEditorValue(draftContent)
            setValidationError(null)
          }
        } else if (blueprintBody?.error) {
          setP4BoundaryMessage(blueprintBody.error)
        }
      } catch {
        setP4BoundaryMessage('')
      }
    } catch (error) {
      setLoadError(errorMessage(error))
      setRules(null)
      setEditorValue('')
      setSavedValue('')
      setP4BoundaryDraft(null)
      setP4BoundaryMessage('')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRules(tenant).catch(() => {})
  }, [loadRules, tenant])

  const handleEditorChange = useCallback((value: string | undefined) => {
    const raw = value || ''
    setEditorValue(raw)
    setToast(null)

    try {
      const parsed = parseBoundaryRulesRaw(raw)
      setRules(parsed)
      setValidationError(null)
    } catch (error) {
      setValidationError(errorMessage(error))
    }
  }, [])

  const saveRules = useCallback(async () => {
    setSaving(true)
    setToast(null)

    try {
      const normalized = stringifyBoundaryRules(parseBoundaryRulesRaw(editorValue))
      const response = await fetch('/api/harness/boundary-reload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant, content: normalized, ...(hash ? { hash } : {}) }),
      })
      const body = await response.json() as ReloadResponse
      if (!response.ok) throw new Error(body.error || '边界规则保存失败')

      setRules(parseBoundaryRulesRaw(normalized))
      setEditorValue(normalized)
      setSavedValue(normalized)
      setHash(body.hash || null)
      setExists(true)
      if (body.mode) setMode(body.mode)
      if (body.note) setModeNote(body.note)
      setValidationError(null)
      showToast({
        kind: 'success',
        title: body.method === 'mock-fallback' ? '已保存并模拟 reload' : '已保存并 reload',
        detail: body.note || `${tenant} 的边界规则已保存${body.latency_ms !== undefined ? `，耗时 ${body.latency_ms}ms` : ''}`,
      })
    } catch (error) {
      showToast({
        kind: 'error',
        title: '保存失败',
        detail: errorMessage(error),
      })
    } finally {
      setSaving(false)
    }
  }, [editorValue, hash, showToast, tenant])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">正在加载边界规则...</div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col gap-4 px-1 pb-6">
      <div className={`${panelClassName} flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between`}>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P8 / 边界规则</p>
          <h1 className="text-2xl font-semibold text-foreground">边界规则确认</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            P4 先产出边界草稿，P7 写进 Agent 的工作说明，P8 在这里保存成后续系统会读取的正式红线。
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border px-2.5 py-1">保存位置：{filePath || '-'}</span>
            <span className="rounded-md border border-border px-2.5 py-1">{exists ? '已落盘' : '草稿待保存'}</span>
            <span className="rounded-md border border-border px-2.5 py-1">运行模式：{displayMode(mode)}</span>
            <span className="rounded-md border border-border px-2.5 py-1">生效方式：{displayReloadStrategy(reloadStrategy)}</span>
            <span className="rounded-md border border-border px-2.5 py-1">{dirty ? '有未保存修改' : '已同步'}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[240px] space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">当前客户</span>
            <select
              className={inputClassName}
              value={tenant}
              onChange={(event) => setTenant(event.target.value)}
              disabled={saving}
            >
              {availableTenants.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <Button variant="ghost" onClick={() => loadRules(tenant)} disabled={loading || saving}>
            刷新
          </Button>
          {p4BoundaryDraft && (
            <Button variant="outline" onClick={applyP4BoundaryDraft} disabled={loading || saving}>
              套用 P4 草稿
            </Button>
          )}
          <Button onClick={() => saveRules()} disabled={saving || !writable || Boolean(validationError) || editorValue.trim().length === 0}>
            {saving ? '保存中...' : '保存并生效'}
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {loadError}
        </div>
      )}

      {validationError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {validationError}
        </div>
      )}

      {!writable && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          当前 Mission Control 进程没有权限写入这个边界文件。
        </div>
      )}

      {mode === 'mock-fallback' && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
          {modeNote || '当前是本机模拟模式：保存会写入本地测试文件，用来跑通 dry run 验证。'}
        </div>
      )}

      {p4BoundaryMessage && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
          {p4BoundaryMessage}
        </div>
      )}

      <div className="grid min-h-[68vh] gap-4 xl:grid-cols-[minmax(280px,0.42fr)_minmax(0,1.58fr)]">
        <section className={`${panelClassName} flex min-h-[60vh] flex-col gap-3 overflow-hidden p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">机器底稿</h2>
              <p className="text-xs text-muted-foreground">一般不用看；右侧确认后这里会同步保存。</p>
            </div>
            <span className="text-xs text-muted-foreground">格式：JSON</span>
          </div>
          <div className="min-h-[560px] flex-1 overflow-hidden rounded-md border border-border">
            {monacoReady ? (
              <MonacoEditor
                height="100%"
                defaultLanguage="json"
                language="json"
                theme="vs-dark"
                value={editorValue}
                onChange={handleEditorChange}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  formatOnPaste: true,
                  formatOnType: true,
                }}
              />
            ) : (
              <div className="flex h-full min-h-[560px] items-center justify-center bg-background/80 text-sm text-muted-foreground">
                正在加载编辑器...
              </div>
            )}
          </div>
        </section>

        <section className={`${panelClassName} flex min-h-[60vh] flex-col overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">结构化检查</h2>
              <p className="text-xs text-muted-foreground">这里把机器规则翻成可检查的表单，保存后才进入后续流程。</p>
            </div>
            <div className="flex rounded-md border border-border bg-background p-1">
              <button
                type="button"
                onClick={() => setActiveTab('forbidden')}
                className={`rounded px-3 py-1.5 text-xs transition ${activeTab === 'forbidden' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                禁止规则 ({forbiddenCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('drift')}
                className={`rounded px-3 py-1.5 text-xs transition ${activeTab === 'drift' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                偏离规则 ({driftCount})
              </button>
            </div>
          </div>

          {!rules ? (
            <div className="m-4 rounded-lg border border-border bg-background/60 px-4 py-6 text-sm text-muted-foreground">
              请先修复左侧 JSON 格式错误，右侧检查表才会恢复。
            </div>
          ) : (
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-sm text-primary">
                <div className="font-semibold text-foreground">老板这一步主要确认三件事</div>
                <div className="mt-2 grid gap-2 text-xs leading-5 text-muted-foreground md:grid-cols-3">
                  <div className="rounded-md border border-primary/20 bg-background/60 p-2">
                    1. 规则是不是当前客户 <span className="font-medium text-foreground">{tenant}</span>，没有混进别的客户。
                  </div>
                  <div className="rounded-md border border-primary/20 bg-background/60 p-2">
                    2. 禁止规则是否来自 P4 的边界草稿，并且和 P7 的 Agent 设定一致。
                  </div>
                  <div className="rounded-md border border-primary/20 bg-background/60 p-2">
                    3. 这些红线是否会影响后续 P9 Skills、Recall 记忆监控和 P19 交付报告。
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  参考来源：P4 的 intake-analysis.md 边界草稿；P7 的 SOUL.md / AGENTS.md 禁止行为和工作规范。
                </div>
                <div className="mt-2 rounded-md border border-primary/20 bg-background/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  要微调时，直接按编号说：第几条红线改成什么、删掉什么、补充什么。确认后再回写 boundary.yaml，不需要改左侧 JSON。
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-md border border-border bg-background/60 px-2.5 py-1">版本：{rules.version || '未设置'}</span>
                <span className="rounded-md border border-border bg-background/60 px-2.5 py-1">更新日期：{rules.last_updated || '未设置'}</span>
                <span className="rounded-md border border-border bg-background/60 px-2.5 py-1">确认视图：只看业务含义，不看内部字段</span>
              </div>

              {activeTab === 'forbidden' ? (
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-semibold text-foreground">禁止规则清单</div>
                    <p className="mt-1 text-xs text-muted-foreground">每条只需要确认：禁止什么、为什么禁止、系统怎么保证。</p>
                  </div>

                  {rules.forbidden_patterns.map((rule, index) => (
                    <div key={rule.id || index} className="rounded-lg border border-border bg-card/70 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-primary">第 {index + 1} 条红线</div>
                          <div className="mt-1 text-base font-semibold leading-6 text-foreground">{rule.label || '未命名禁止规则'}</div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1.5 text-xs">
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-200">
                            {displaySeverity(rule.severity)}
                          </span>
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-primary">
                            {displayAction(rule.action)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                        <div className="rounded-md border border-border bg-background/60 p-3">
                          <div className="text-xs font-semibold text-muted-foreground">禁止什么</div>
                          <p className="mt-1 leading-6 text-foreground">{rule.label || rule.id}</p>
                        </div>
                        <div className="rounded-md border border-border bg-background/60 p-3">
                          <div className="text-xs font-semibold text-muted-foreground">为什么禁止</div>
                          <p className="mt-1 leading-6 text-foreground">{forbiddenReason(rule)}</p>
                        </div>
                        <div className="rounded-md border border-border bg-background/60 p-3">
                          <div className="text-xs font-semibold text-muted-foreground">怎么保证</div>
                          <p className="mt-1 leading-6 text-foreground">{forbiddenGuarantee(rule)}</p>
                        </div>
                      </div>

                      <div className="mt-3 rounded-md border border-dashed border-border bg-background/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                        系统识别线索：{ruleSignal(rule)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">偏离规则清单</div>
                    <p className="mt-1 text-xs text-muted-foreground">用来发现 Agent 输出是否偏离客户设定。</p>
                  </div>

                  {rules.drift_patterns.map((rule, index) => {
                    return (
                      <div key={rule.id || index} className="rounded-lg border border-border bg-card/70 p-4">
                        <div className="text-xs font-semibold text-primary">第 {index + 1} 条偏离检查</div>
                        <div className="mt-1 text-base font-semibold text-foreground">{rule.id || '未命名偏离规则'}</div>
                        <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                          <div className="rounded-md border border-border bg-background/60 p-3">
                            <div className="text-xs font-semibold text-muted-foreground">为什么关注</div>
                            <p className="mt-1 leading-6 text-foreground">避免 Agent 输出偏离当前客户的角色、范围或交付标准。</p>
                          </div>
                          <div className="rounded-md border border-border bg-background/60 p-3">
                            <div className="text-xs font-semibold text-muted-foreground">怎么保证</div>
                            <p className="mt-1 leading-6 text-foreground">{driftGuarantee(rule)}</p>
                          </div>
                        </div>
                        <div className="mt-3 rounded-md border border-dashed border-border bg-background/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                          系统识别线索：{ruleSignal(rule)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 w-[320px] rounded-lg border px-4 py-3 shadow-lg ${
          toast.kind === 'success'
            ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100'
            : toast.kind === 'error'
              ? 'border-red-500/30 bg-red-500/15 text-red-100'
              : 'border-border bg-card text-foreground'
        }`}>
          <div className="text-sm font-semibold">{toast.title}</div>
          <div className="mt-0.5 text-xs opacity-80">{toast.detail}</div>
        </div>
      )}
    </div>
  )
}
