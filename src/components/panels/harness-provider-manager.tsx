'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TENANT_OPTIONS } from '@/components/panels/budget-settings-block'
import { isCustomerRole, readEffectiveRoleFromBrowser } from '@/lib/rbac'

type ProviderRecord = {
  name: string
  baseUrl: string
  keyLast4: string | null
  apiKey: string | null
  maskedKey: string | null
  systemLevel: boolean
}

type ProviderDraft = {
  name: string
  baseUrl: string
  apiKey: string
}

const EMPTY_DRAFT: ProviderDraft = {
  name: '',
  baseUrl: '',
  apiKey: '',
}

export function maskApiKey(value: string | null | undefined): string {
  const key = String(value || '').trim()
  if (!key) return 'No key'
  if (key.length <= 7) return `${key.slice(0, 3)}****${key.slice(-1)}`
  return `${key.slice(0, 3)}****${key.slice(-4)}`
}

function isSystemProvider(raw: any): boolean {
  return raw?.isSystem === true
    || raw?.is_system === true
    || raw?.isMaster === true
    || raw?.is_master === true
    || raw?.master === true
    || raw?.scope === 'system'
    || raw?.kind === 'master'
}

function normalizeProvider(raw: any): ProviderRecord {
  return {
    name: String(raw?.name || raw?.id || 'provider'),
    baseUrl: String(raw?.baseUrl || raw?.base_url || raw?.url || ''),
    keyLast4: typeof raw?.keyLast4 === 'string'
      ? raw.keyLast4
      : typeof raw?.key_last4 === 'string'
        ? raw.key_last4
        : typeof raw?.apiKeyLast4 === 'string'
          ? raw.apiKeyLast4
          : null,
    apiKey: typeof raw?.apiKey === 'string'
      ? raw.apiKey
      : typeof raw?.api_key === 'string'
        ? raw.api_key
        : null,
    maskedKey: typeof raw?.maskedKey === 'string'
      ? raw.maskedKey
      : typeof raw?.masked_key === 'string'
        ? raw.masked_key
        : null,
    systemLevel: isSystemProvider(raw),
  }
}

export function HarnessProviderManager() {
  const [effectiveRole] = useState(() => readEffectiveRoleFromBrowser())
  const [tenantId, setTenantId] = useState(TENANT_OPTIONS[0].id)
  const [providers, setProviders] = useState<ProviderRecord[]>([])
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isCustomer = isCustomerRole(effectiveRole)

  const loadProviders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/harness/providers?tenantId=${encodeURIComponent(tenantId)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load providers')
      const list = Array.isArray(data.providers) ? data.providers : Array.isArray(data.items) ? data.items : []
      setProviders(list.map(normalizeProvider))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProviders([])
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  function updateDraft<K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  async function saveProvider() {
    setSaving(true)
    setFeedback(null)
    setError(null)
    const payload = {
      tenantId,
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey,
    }
    try {
      const res = await fetch('/api/harness/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save provider')
      setFeedback(`${payload.name} saved`)
      setDraft(EMPTY_DRAFT)
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function testProvider(name: string) {
    setTesting(name)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch(`/api/harness/providers/${encodeURIComponent(name)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || data.detail || `${name} failed`)
      setFeedback(`${name} OK`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(null)
    }
  }

  async function deleteProvider(name: string) {
    setDeleting(name)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch(`/api/harness/providers/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed to delete ${name}`)
      setFeedback(`${name} deleted`)
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(null)
    }
  }

  const canSave = draft.name.trim() && draft.baseUrl.trim() && draft.apiKey
  const visibleProviders = isCustomer ? providers.filter(provider => !provider.systemLevel) : providers
  const formatProviderKey = (provider: ProviderRecord) => {
    if (isCustomer) {
      if (provider.apiKey) return maskApiKey(provider.apiKey)
      if (provider.maskedKey) return provider.maskedKey
    }
    return provider.keyLast4 ? `•••• ${provider.keyLast4}` : 'No key'
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Harness providers</h2>
          <p className="mt-1 text-xs text-muted-foreground">Tenant-scoped model provider credentials stored by Genesis Harness.</p>
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Tenant
          <select
            aria-label="Tenant"
            value={tenantId}
            onChange={event => setTenantId(event.target.value)}
            className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground"
          >
            {TENANT_OPTIONS.map(tenant => (
              <option key={tenant.id} value={tenant.id}>{tenant.id}</option>
            ))}
          </select>
        </label>
      </div>

      {feedback && (
        <div className="mt-4 rounded border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">{feedback}</div>
      )}
      {error && (
        <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {visibleProviders.map(provider => (
          <div key={provider.name} className="rounded-lg border border-border bg-secondary/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{provider.name}</div>
                <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{provider.baseUrl || 'Base URL not set'}</div>
                <div className="mt-2 inline-flex rounded bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {formatProviderKey(provider)}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Test ${provider.name}`}
                  onClick={() => testProvider(provider.name)}
                  disabled={testing === provider.name || deleting === provider.name}
                >
                  {testing === provider.name ? 'Testing' : 'Test'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${provider.name}`}
                  onClick={() => deleteProvider(provider.name)}
                  disabled={deleting === provider.name || testing === provider.name}
                  className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                >
                  {deleting === provider.name ? 'Deleting' : 'Delete'}
                </Button>
              </div>
            </div>
          </div>
        ))}
        {!visibleProviders.length && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground md:col-span-2">
            {loading ? 'Loading providers...' : 'No providers saved for this tenant.'}
          </div>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-border bg-secondary/20 p-4">
        <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Provider name
            <input
              aria-label="Provider name"
              value={draft.name}
              onChange={event => updateDraft('name', event.target.value)}
              placeholder="openrouter"
              className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Base URL
            <input
              aria-label="Base URL"
              value={draft.baseUrl}
              onChange={event => updateDraft('baseUrl', event.target.value)}
              placeholder="https://api.example.com/v1"
              className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            API key
            <input
              aria-label="API key"
              type="password"
              value={draft.apiKey}
              onChange={event => updateDraft('apiKey', event.target.value)}
              placeholder="sk-..."
              className="h-9 rounded border border-border bg-background px-3 text-sm text-foreground"
              autoComplete="off"
              data-1p-ignore
            />
          </label>
          <div className="flex items-end">
            <Button type="button" size="sm" onClick={saveProvider} disabled={!canSave || saving}>
              {saving ? 'Saving' : 'Save provider'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
