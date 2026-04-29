'use client'

import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import loader from '@monaco-editor/loader'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import {
  createBlankDriftRule,
  createBlankForbiddenRule,
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
const inputClassName = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10'
const textareaClassName = `${inputClassName} min-h-[86px] resize-y font-mono text-xs`
const panelClassName = 'rounded-lg border border-border bg-card/70'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error')
}

function nextRuleId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function summarizeDrift(rule: DriftRule) {
  return [rule.id, rule.category].filter(Boolean).join(' · ')
}

function groupForbiddenRules(rules: ForbiddenRule[]) {
  return rules.reduce<Record<string, Array<{ rule: ForbiddenRule; index: number }>>>((groups, rule, index) => {
    const key = rule.category || '未分组'
    groups[key] = groups[key] || []
    groups[key].push({ rule, index })
    return groups
  }, {})
}

function fieldList(value: string[] | undefined) {
  return Array.isArray(value) ? value.join('\n') : ''
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

function translatedForbiddenSummary(rule: ForbiddenRule) {
  return `${displaySeverity(rule.severity)} · ${displayAction(rule.action)} · ${rule.category || '未分组'}`
}

export function BoundaryEditorPanel() {
  const { activeTenant } = useMissionControl()
  const searchParams = useSearchParams()
  const requestedTenant = searchParams.get('tenant') || searchParams.get('tenant_id')
  const urlTenant = requestedTenant && tenantOptions.includes(requestedTenant) ? requestedTenant : ''
  const [tenant, setTenant] = useState(urlTenant || activeTenant?.slug || 'media-intel-v1')
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
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dirty = editorValue !== savedValue
  const forbiddenGroups = useMemo(() => groupForbiddenRules(rules?.forbidden_patterns || []), [rules])
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
    if (activeTenant?.slug) setTenant(activeTenant.slug)
  }, [activeTenant?.slug, urlTenant])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedRules(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

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
        const firstIds = [
          ...body.rules.forbidden_patterns.slice(0, 2).map(rule => `forbidden-${rule.id}`),
          ...body.rules.drift_patterns.slice(0, 1).map(rule => `drift-${rule.id}`),
        ]
        setExpandedRules(new Set(firstIds))
      } else {
        setRules(null)
        setValidationError(body.parse_error || '边界规则 JSON 格式不正确')
        setExpandedRules(new Set())
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
            const firstIds = blueprint.boundary_rules.forbidden_patterns.slice(0, 2).map(rule => `forbidden-${rule.id}`)
            setExpandedRules(new Set(firstIds))
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

  const updateForbiddenRule = useCallback((index: number, update: (rule: ForbiddenRule) => ForbiddenRule) => {
    if (!rules) return
    applyRules({
      ...rules,
      forbidden_patterns: rules.forbidden_patterns.map((rule, ruleIndex) => (
        ruleIndex === index ? update(rule) : rule
      )),
    })
  }, [applyRules, rules])

  const updateDriftRule = useCallback((index: number, update: (rule: DriftRule) => DriftRule) => {
    if (!rules) return
    applyRules({
      ...rules,
      drift_patterns: rules.drift_patterns.map((rule, ruleIndex) => (
        ruleIndex === index ? update(rule) : rule
      )),
    })
  }, [applyRules, rules])

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

      <div className="grid min-h-[68vh] gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section className={`${panelClassName} flex min-h-[60vh] flex-col gap-3 overflow-hidden p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">规则原文</h2>
              <p className="text-xs text-muted-foreground">左侧是机器会读取的 JSON，改动后右侧会同步刷新。</p>
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
                    3. 这些红线是否会影响后续 P9 Skills、P13 记忆验证和 P22 交付报告。
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  参考来源：P4 的 intake-analysis.md 边界草稿；P7 的 SOUL.md / AGENTS.md 禁止行为和工作规范。
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">规则版本</span>
                  <input
                    className={inputClassName}
                    value={rules.version}
                    onChange={(event) => applyRules({ ...rules, version: event.target.value })}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">最后更新</span>
                  <input
                    className={inputClassName}
                    value={rules.last_updated}
                    onChange={(event) => applyRules({ ...rules, last_updated: event.target.value })}
                  />
                </label>
              </div>

              {activeTab === 'forbidden' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-foreground">按分组查看禁止规则</div>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const blank = createBlankForbiddenRule()
                        blank.id = nextRuleId('forbidden')
                        applyRules({ ...rules, forbidden_patterns: [...rules.forbidden_patterns, blank] })
                        setExpandedRules(current => new Set([...current, `forbidden-${blank.id}`]))
                      }}
                    >
                      新增规则
                    </Button>
                  </div>

                  {Object.entries(forbiddenGroups).map(([category, entries]) => (
                    <div key={category} className="rounded-lg border border-border bg-background/50">
                      <div className="flex items-center justify-between border-b border-border px-3 py-2">
                        <div className="text-sm font-semibold text-foreground">{category}</div>
                        <div className="text-xs text-muted-foreground">{entries.length} 条规则</div>
                      </div>
                      <div className="space-y-2 p-3">
                        {entries.map(({ rule, index }) => {
                          const key = `forbidden-${rule.id || index}`
                          const expanded = expandedRules.has(key)
                          return (
                            <div key={key} className="rounded-md border border-border bg-card/60">
                              <button
                                type="button"
                                onClick={() => toggleExpanded(key)}
                                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium text-foreground">{rule.label || rule.id}</span>
                                  <span className="block truncate text-xs text-muted-foreground">{translatedForbiddenSummary(rule)}</span>
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">{expanded ? '收起' : '展开'}</span>
                              </button>

                              {expanded && (
                                <div className="space-y-3 border-t border-border p-3">
                                  <div className="rounded-md border border-border bg-background/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
                                    判断方式：匹配到下面的关键词/正则时，系统按“{displayAction(rule.action)}”处理。给老板看时主要确认这条红线是否合理，不需要改内部英文值。
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <RuleTextField label="规则 ID" value={rule.id} onChange={(value) => updateForbiddenRule(index, current => ({ ...current, id: value }))} />
                                    <RuleTextField label="规则分组" value={rule.category} onChange={(value) => updateForbiddenRule(index, current => ({ ...current, category: value }))} />
                                    <RuleTextField label={`风险等级：${displaySeverity(rule.severity)}`} value={rule.severity} onChange={(value) => updateForbiddenRule(index, current => ({ ...current, severity: value }))} />
                                    <RuleTextField label={`处理方式：${displayAction(rule.action)}`} value={rule.action} onChange={(value) => updateForbiddenRule(index, current => ({ ...current, action: value }))} />
                                    <RuleTextField label="老板可读标题" value={rule.label} onChange={(value) => updateForbiddenRule(index, current => ({ ...current, label: value }))} />
                                    <RuleTextField label="正则匹配" value={rule.pattern} onChange={(value) => updateForbiddenRule(index, current => ({ ...current, pattern: value }))} />
                                  </div>
                                  <label className="block space-y-1.5">
                                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">关键词 / 句式匹配</span>
                                    <textarea
                                      className={textareaClassName}
                                      value={fieldList(rule.patterns)}
                                      onChange={(event) => updateForbiddenRule(index, current => ({
                                        ...current,
                                        patterns: event.target.value.split('\n').map(item => item.trim()).filter(Boolean),
                                      }))}
                                    />
                                  </label>
                                  <label className="block space-y-1.5">
                                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">触发后的提示语</span>
                                    <textarea
                                      className={textareaClassName}
                                      value={rule.response_template}
                                      onChange={(event) => updateForbiddenRule(index, current => ({ ...current, response_template: event.target.value }))}
                                    />
                                  </label>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-foreground">偏离规则</div>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const blank = createBlankDriftRule()
                        blank.id = nextRuleId('drift')
                        applyRules({ ...rules, drift_patterns: [...rules.drift_patterns, blank] })
                        setExpandedRules(current => new Set([...current, `drift-${blank.id}`]))
                      }}
                    >
                      新增偏离规则
                    </Button>
                  </div>

                  {rules.drift_patterns.map((rule, index) => {
                    const key = `drift-${rule.id || index}`
                    const expanded = expandedRules.has(key)
                    return (
                      <div key={key} className="rounded-md border border-border bg-card/60">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(key)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-foreground">{rule.id}</span>
                            <span className="block truncate text-xs text-muted-foreground">{summarizeDrift(rule)}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{expanded ? '收起' : '展开'}</span>
                        </button>

                        {expanded && (
                          <div className="space-y-3 border-t border-border p-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <RuleTextField label="规则 ID" value={rule.id} onChange={(value) => updateDriftRule(index, current => ({ ...current, id: value }))} />
                              <RuleTextField label="规则分组" value={rule.category} onChange={(value) => updateDriftRule(index, current => ({ ...current, category: value }))} />
                            </div>
                            <RuleTextField label="正则匹配" value={rule.pattern} onChange={(value) => updateDriftRule(index, current => ({ ...current, pattern: value }))} />
                          </div>
                        )}
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

function RuleTextField({ label, value, onChange }: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        className={inputClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
