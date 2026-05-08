import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { proxyHarnessConsoleJson, routeParams } from '@/lib/harness-console-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TONE_OPTIONS = ['professional', 'warm', 'direct'] as const
const LANGUAGE_OPTIONS = ['zh-CN', 'en-US', 'bilingual'] as const
const RESPONSE_LENGTH_OPTIONS = ['brief', 'balanced', 'detailed'] as const

const preferenceSchema = z.object({
  tone: z.enum(TONE_OPTIONS),
  language: z.enum(LANGUAGE_OPTIONS),
  response_length: z.enum(RESPONSE_LENGTH_OPTIONS),
}).strict()

type PreferencesRouteContext = {
  params: { name: string } | Promise<{ name: string }>
}

type AgentPreferences = z.infer<typeof preferenceSchema>

const DEFAULT_PREFERENCES: AgentPreferences = {
  tone: 'professional',
  language: 'zh-CN',
  response_length: 'balanced',
}

function normalizeAgentName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) {
    throw new Error('name is required')
  }
  return name
}

function withNoStore(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

function readPreferenceValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T[number]
    : fallback
}

function resolveAuthorizedAgentName(workspaceId: number, rawName: unknown): string | null {
  const name = normalizeAgentName(rawName)
  const row = getDatabase()
    .prepare('SELECT name FROM agents WHERE name = ? AND workspace_id = ? LIMIT 1')
    .get(name, workspaceId) as { name?: unknown } | undefined

  return typeof row?.name === 'string' && row.name.trim() ? row.name : null
}

async function proxyAgentConfig(input: {
  method: 'GET' | 'PUT'
  name: string
  body?: { preferences: AgentPreferences }
  failureMessage: string
}) {
  try {
    return await proxyHarnessConsoleJson({
      method: input.method,
      path: `/agents/${encodeURIComponent(input.name)}/config`,
      body: input.body,
    })
  } catch {
    return withNoStore(502, { error: input.failureMessage })
  }
}

function selectPreferences(payload: unknown): AgentPreferences {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return DEFAULT_PREFERENCES
  }

  const source = payload as Record<string, unknown>
  const nested = source.preferences
  const preferences = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : source

  return {
    tone: readPreferenceValue(preferences.tone, TONE_OPTIONS, DEFAULT_PREFERENCES.tone),
    language: readPreferenceValue(preferences.language, LANGUAGE_OPTIONS, DEFAULT_PREFERENCES.language),
    response_length: readPreferenceValue(preferences.response_length, RESPONSE_LENGTH_OPTIONS, DEFAULT_PREFERENCES.response_length),
  }
}

export async function GET(request: NextRequest, context: PreferencesRouteContext) {
  const auth = requireRole(request, 'customer-admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { name: rawName } = await routeParams(context.params)
    const name = resolveAuthorizedAgentName(auth.user.workspace_id ?? 1, rawName)
    if (!name) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const response = await proxyAgentConfig({
      method: 'GET',
      name,
      failureMessage: 'Failed to load preferences',
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      return withNoStore(response.status >= 500 ? 502 : response.status, { error: 'Failed to load preferences' })
    }

    return withNoStore(response.status, selectPreferences(payload))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}

export async function PUT(request: NextRequest, context: PreferencesRouteContext) {
  const auth = requireRole(request, 'customer-admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { name: rawName } = await routeParams(context.params)
    const name = resolveAuthorizedAgentName(auth.user.workspace_id ?? 1, rawName)
    if (!name) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const parsed = preferenceSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid preferences payload', details: parsed.error.flatten() }, { status: 400 })
    }

    const upstream = await proxyAgentConfig({
      method: 'PUT',
      name,
      body: { preferences: parsed.data },
      failureMessage: 'Failed to save preferences',
    })
    const payload = await upstream.json().catch(() => null)

    if (!upstream.ok) {
      return withNoStore(upstream.status >= 500 ? 502 : upstream.status, { error: 'Failed to save preferences' })
    }

    return withNoStore(upstream.status, {
      ok: true,
      preferences: parsed.data,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
