'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import loader from '@monaco-editor/loader'
import * as monaco from 'monaco-editor'
import { Button } from '@/components/ui/button'
import {
  createBlankDriftRule,
  createBlankForbiddenRule,
  createEmptyBoundaryRules,
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

loader.config({ monaco })

interface BoundaryRulesResponse {
  path: string
  exists: boolean
  hash: string | null
  raw: string
  rules: BoundaryRules | null
  parse_error: string | null
  source: 'workspace' | 'generated'
  writable: boolean
  reload_strategy: 'reload' | 'restart'
}

const inputClassName = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10'
const textareaClassName = `${inputClassName} min-h-[96px] resize-y font-mono text-xs`
const cardClassName = 'rounded-2xl border border-border bg-card/70 p-4 shadow-sm'

function nextRuleId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

function ruleErrorMessage(error: unknown): string | null {
  if (!error) return null
  return error instanceof Error ? error.message : String(error)
}

export function BoundaryEditorPanel() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rules, setRules] = useState<BoundaryRules | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveInfo, setSaveInfo] = useState<string | null>(null)
  const [filePath, setFilePath] = useState('/workspace/config/boundary-rules.json')
  const [hash, setHash] = useState<string | null>(null)
  const [writable, setWritable] = useState(false)
  const [reloadStrategy, setReloadStrategy] = useState<'reload' | 'restart'>('reload')
  const [source, setSource] = useState<'workspace' | 'generated'>('generated')
  const [exists, setExists] = useState(false)

  const dirty = useMemo(() => {
    if (!rules) return editorValue.trim().length > 0
    try {
      return stringifyBoundaryRules(rules) !== editorValue
    } catch {
      return true
    }
  }, [editorValue, rules])

  const applyRules = useCallback((nextRules: BoundaryRules) => {
    setRules(nextRules)
    const nextRaw = stringifyBoundaryRules(nextRules)
    setEditorValue(nextRaw)
    try {
      validateBoundaryRules(nextRules)
      setValidationError(null)
    } catch (error) {
      setValidationError(ruleErrorMessage(error))
    }
    setSaveInfo(null)
    setSaveError(null)
  }, [])

  const loadRules = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setSaveError(null)
    setSaveInfo(null)

    try {
      const response = await fetch('/api/harness/boundary-rules', { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to load boundary rules')
      }

      const payload = body as BoundaryRulesResponse
      setFilePath(payload.path)
      setHash(payload.hash)
      setWritable(payload.writable)
      setReloadStrategy(payload.reload_strategy)
      setSource(payload.source)
      setExists(payload.exists)
      setEditorValue(payload.raw)

      if (payload.rules) {
        setRules(payload.rules)
        setValidationError(payload.parse_error)
      } else {
        setRules(null)
        setValidationError(payload.parse_error || 'Boundary rules JSON is invalid')
      }
    } catch (error) {
      setLoadError(ruleErrorMessage(error) || 'Failed to load boundary rules')
      const emptyRules = createEmptyBoundaryRules()
      setRules(emptyRules)
      setEditorValue(stringifyBoundaryRules(emptyRules))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRules().catch(() => {})
  }, [loadRules])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      ;(window as typeof window & { monaco?: typeof monaco }).monaco = monaco
    }
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    const raw = value || ''
    setEditorValue(raw)
    setSaveInfo(null)
    setSaveError(null)

    try {
      const parsed = parseBoundaryRulesRaw(raw)
      setRules(parsed)
      setValidationError(null)
    } catch (error) {
      setValidationError(ruleErrorMessage(error))
    }
  }, [])

  const updateForbiddenRule = useCallback((index: number, update: (rule: ForbiddenRule) => ForbiddenRule) => {
    if (!rules) return
    const nextRules: BoundaryRules = {
      ...rules,
      forbidden_patterns: rules.forbidden_patterns.map((rule, ruleIndex) => (
        ruleIndex === index ? update(rule) : rule
      )),
    }
    applyRules(nextRules)
  }, [applyRules, rules])

  const updateDriftRule = useCallback((index: number, update: (rule: DriftRule) => DriftRule) => {
    if (!rules) return
    const nextRules: BoundaryRules = {
      ...rules,
      drift_patterns: rules.drift_patterns.map((rule, ruleIndex) => (
        ruleIndex === index ? update(rule) : rule
      )),
    }
    applyRules(nextRules)
  }, [applyRules, rules])

  const saveRules = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    setSaveInfo(null)

    try {
      const normalized = stringifyBoundaryRules(parseBoundaryRulesRaw(editorValue))
      const response = await fetch('/api/harness/boundary-reload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: normalized, hash }),
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to save boundary rules')
      }

      const parsed = parseBoundaryRulesRaw(normalized)
      setRules(parsed)
      setEditorValue(normalized)
      setHash(body.hash || null)
      setValidationError(null)
      setExists(true)
      setSaveInfo(`Saved successfully via ${body.method} in ${body.latency_ms} ms. ${body.note || ''}`.trim())
    } catch (error) {
      setSaveError(ruleErrorMessage(error) || 'Failed to save boundary rules')
    } finally {
      setSaving(false)
    }
  }, [editorValue, hash])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading boundary rules…</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 px-1 pb-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/70 p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Boundary Editor</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Edit the tenant boundary rules JSON and push changes straight into `/workspace/config/boundary-rules.json`.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border px-2.5 py-1">Source: {source}</span>
            <span className="rounded-full border border-border px-2.5 py-1">Path: {filePath}</span>
            <span className="rounded-full border border-border px-2.5 py-1">Apply mode: {reloadStrategy}</span>
            <span className="rounded-full border border-border px-2.5 py-1">{exists ? 'On disk' : 'Generated draft'}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="ghost" onClick={() => loadRules()} disabled={loading || saving}>
            Refresh
          </Button>
          <Button onClick={() => saveRules()} disabled={saving || !writable || Boolean(validationError) || editorValue.trim().length === 0}>
            {saving ? 'Saving…' : 'Save Boundary Rules'}
          </Button>
        </div>
      </div>

      {!writable && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Mission Control is currently mounted with read-only `/workspace`. Remount the container as read-write before saving.
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {loadError}
        </div>
      )}

      {validationError && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {validationError}
        </div>
      )}

      {saveError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {saveError}
        </div>
      )}

      {saveInfo && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {saveInfo}
        </div>
      )}

      <div className="grid min-h-[68vh] gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section className={`${cardClassName} flex min-h-[60vh] flex-col gap-3 overflow-hidden`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Raw JSON</h2>
              <p className="text-xs text-muted-foreground">Editing valid JSON here will sync the structured form on the right.</p>
            </div>
            <span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'In sync'}</span>
          </div>
          <div className="min-h-[560px] flex-1 overflow-hidden rounded-xl border border-border">
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
          </div>
        </section>

        <section className={`${cardClassName} min-h-[60vh] space-y-4 overflow-y-auto`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Structured Rules</h2>
              <p className="text-xs text-muted-foreground">Editing the form updates the JSON editor immediately.</p>
            </div>
          </div>

          {!rules && (
            <div className="rounded-2xl border border-border bg-background/60 px-4 py-6 text-sm text-muted-foreground">
              Fix the JSON validation errors in the editor to unlock the structured form view.
            </div>
          )}

          {rules && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Version</span>
                  <input
                    className={inputClassName}
                    value={rules.version}
                    onChange={(event) => applyRules({ ...rules, version: event.target.value })}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last updated</span>
                  <input
                    className={inputClassName}
                    value={rules.last_updated}
                    onChange={(event) => applyRules({ ...rules, last_updated: event.target.value })}
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Forbidden Rules</h3>
                    <p className="text-xs text-muted-foreground">Hard blocks with response templates and enforcement action.</p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const blank = createBlankForbiddenRule()
                      blank.id = nextRuleId('forbidden')
                      applyRules({
                        ...rules,
                        forbidden_patterns: [...rules.forbidden_patterns, blank],
                      })
                    }}
                  >
                    Add forbidden rule
                  </Button>
                </div>

                {rules.forbidden_patterns.map((rule, index) => (
                  <div key={rule.id || index} className="rounded-2xl border border-border bg-background/60 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">Rule {index + 1}</h4>
                        <p className="text-xs text-muted-foreground">Edit the block rule and its operator-facing response.</p>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => applyRules({
                          ...rules,
                          forbidden_patterns: rules.forbidden_patterns.filter((_, ruleIndex) => ruleIndex !== index),
                        })}
                      >
                        Remove
                      </Button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ID</span>
                        <input
                          className={inputClassName}
                          value={rule.id}
                          onChange={(event) => updateForbiddenRule(index, current => ({ ...current, id: event.target.value }))}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Category</span>
                        <input
                          className={inputClassName}
                          value={rule.category}
                          onChange={(event) => updateForbiddenRule(index, current => ({ ...current, category: event.target.value }))}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Label</span>
                        <input
                          className={inputClassName}
                          value={rule.label}
                          onChange={(event) => updateForbiddenRule(index, current => ({ ...current, label: event.target.value }))}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Severity</span>
                        <input
                          className={inputClassName}
                          value={rule.severity}
                          onChange={(event) => updateForbiddenRule(index, current => ({ ...current, severity: event.target.value }))}
                        />
                      </label>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Action</span>
                        <input
                          className={inputClassName}
                          value={rule.action}
                          onChange={(event) => updateForbiddenRule(index, current => ({ ...current, action: event.target.value }))}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Regex pattern</span>
                        <input
                          className={inputClassName}
                          value={rule.pattern}
                          onChange={(event) => updateForbiddenRule(index, current => ({ ...current, pattern: event.target.value }))}
                        />
                      </label>
                    </div>

                    <label className="mt-3 block space-y-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Keyword patterns</span>
                      <textarea
                        className={textareaClassName}
                        value={rule.patterns.join('\n')}
                        onChange={(event) => updateForbiddenRule(index, current => ({
                          ...current,
                          patterns: event.target.value
                            .split('\n')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        }))}
                      />
                    </label>

                    <label className="mt-3 block space-y-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Response template</span>
                      <textarea
                        className={textareaClassName}
                        value={rule.response_template}
                        onChange={(event) => updateForbiddenRule(index, current => ({ ...current, response_template: event.target.value }))}
                      />
                    </label>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Drift Rules</h3>
                    <p className="text-xs text-muted-foreground">Soft drift detectors that can flag degraded or out-of-scope answers.</p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const blank = createBlankDriftRule()
                      blank.id = nextRuleId('drift')
                      applyRules({
                        ...rules,
                        drift_patterns: [...rules.drift_patterns, blank],
                      })
                    }}
                  >
                    Add drift rule
                  </Button>
                </div>

                {rules.drift_patterns.map((rule, index) => (
                  <div key={rule.id || index} className="rounded-2xl border border-border bg-background/60 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">Drift {index + 1}</h4>
                        <p className="text-xs text-muted-foreground">Keep the regex specific enough to avoid noisy matches.</p>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => applyRules({
                          ...rules,
                          drift_patterns: rules.drift_patterns.filter((_, ruleIndex) => ruleIndex !== index),
                        })}
                      >
                        Remove
                      </Button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ID</span>
                        <input
                          className={inputClassName}
                          value={rule.id}
                          onChange={(event) => updateDriftRule(index, current => ({ ...current, id: event.target.value }))}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Category</span>
                        <input
                          className={inputClassName}
                          value={rule.category}
                          onChange={(event) => updateDriftRule(index, current => ({ ...current, category: event.target.value }))}
                        />
                      </label>
                    </div>

                    <label className="mt-3 block space-y-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Regex pattern</span>
                      <input
                        className={inputClassName}
                        value={rule.pattern}
                        onChange={(event) => updateDriftRule(index, current => ({ ...current, pattern: event.target.value }))}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
