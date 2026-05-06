import 'server-only'

import { NextRequest, NextResponse } from 'next/server'

type JsonObject = Record<string, unknown>

export function resolveHarnessConsoleBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.MC_HARNESS_CONSOLE_URL
    || env.MC_HARNESS_API_URL
    || env.GENESIS_HARNESS_API_URL
    || 'http://127.0.0.1:3088'
  return raw.replace(/\/+$/, '')
}

export function normalizeConsoleTenantId(value: unknown, field = 'tenantId'): string {
  const tenantId = typeof value === 'string' ? value.trim() : ''
  if (!/^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$|^[a-z0-9]$/.test(tenantId)) {
    throw new Error(`${field} must contain only lowercase letters, numbers, and hyphens`)
  }
  return tenantId
}

export function normalizeProviderName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name)) {
    throw new Error('provider name must contain only letters, numbers, dots, underscores, and hyphens')
  }
  return name
}

export function normalizeConsoleMonth(value: unknown): string {
  const month = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('month must be YYYY-MM format')
  }
  return month
}

export function sanitizeBudgetPayload(body: Record<string, unknown>): Record<string, unknown> {
  const ALLOWED_KEYS = ['monthly_budget_usd', 'alert_at_percent', 'action_on_exceed'] as const
  const ALLOWED_ACTIONS = ['pause', 'warn', 'warn-only', 'block-new-only'] as const
  const sanitized: Record<string, unknown> = {}
  for (const key of ALLOWED_KEYS) {
    if (body[key] !== undefined) sanitized[key] = body[key]
  }
  if (typeof sanitized.monthly_budget_usd === 'number') {
    sanitized.monthly_budget_usd = Math.max(0, Math.min(10000, sanitized.monthly_budget_usd))
  }
  if (typeof sanitized.alert_at_percent === 'number') {
    sanitized.alert_at_percent = Math.max(1, Math.min(100, Math.round(sanitized.alert_at_percent)))
  }
  if (typeof sanitized.action_on_exceed === 'string' && !(ALLOWED_ACTIONS as readonly string[]).includes(sanitized.action_on_exceed)) {
    sanitized.action_on_exceed = 'pause'
  }
  return sanitized
}

export function sanitizeProviderPayload(body: Record<string, unknown>): Record<string, unknown> {
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : ''
  if (baseUrl && !/^https?:\/\/.+/i.test(baseUrl)) {
    throw new Error('baseUrl must be a valid HTTP(S) URL')
  }
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
  if (apiKey.length > 512) {
    throw new Error('apiKey exceeds maximum length')
  }
  return { ...body, baseUrl, apiKey }
}

export async function routeParams<T extends Record<string, string>>(
  params: T | Promise<T>,
): Promise<T> {
  return Promise.resolve(params)
}

export async function readJsonObject(request: NextRequest): Promise<JsonObject> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('payload must be a JSON object')
  }
  return body as JsonObject
}

export async function proxyHarnessConsoleJson(input: {
  method: 'GET' | 'POST'
  path: string
  search?: URLSearchParams
  body?: JsonObject
}) {
  const query = input.search?.toString()
  const url = `${resolveHarnessConsoleBaseUrl()}/api/console${input.path}${query ? `?${query}` : ''}`
  const upstream = await fetch(url, {
    method: input.method,
    headers: input.body ? { 'content-type': 'application/json' } : undefined,
    body: input.body ? JSON.stringify(input.body) : undefined,
    cache: 'no-store',
  })

  const contentType = upstream.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? await upstream.json().catch(() => null)
    : { error: await upstream.text().catch(() => upstream.statusText) }

  return NextResponse.json(payload ?? {}, {
    status: upstream.status,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
