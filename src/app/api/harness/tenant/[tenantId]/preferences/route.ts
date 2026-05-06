import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import {
  normalizeConsoleTenantId,
  readJsonObject,
  resolveHarnessConsoleBaseUrl,
  routeParams,
} from '@/lib/harness-console-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type PreferencesRouteContext = {
  params: { tenantId: string } | Promise<{ tenantId: string }>
}

const notificationSchema = z.object({
  email: z.boolean().optional(),
  budgetAlerts: z.boolean().optional(),
  deliveryUpdates: z.boolean().optional(),
}).strict()

const preferencePatchSchema = z.object({
  default_model: z.string().trim().min(1).max(200).optional(),
  notifications: notificationSchema.optional(),
}).strict().refine(
  value => value.default_model !== undefined || value.notifications !== undefined,
  { message: 'At least one preference field is required' },
)

type NotificationPreferences = z.infer<typeof notificationSchema>
type PreferencePatch = z.infer<typeof preferencePatchSchema>
type TenantPreferences = {
  default_model?: string
  notifications: NotificationPreferences
}

const NOTIFICATION_KEYS = ['email', 'budgetAlerts', 'deliveryUpdates'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveAuthenticatedTenantSlug(sessionTenantId: unknown): string | null {
  if (typeof sessionTenantId === 'string') {
    try {
      return normalizeConsoleTenantId(sessionTenantId, 'tenantId')
    } catch {
      return null
    }
  }

  if (typeof sessionTenantId !== 'number' || !Number.isInteger(sessionTenantId)) return null
  const row = getDatabase()
    .prepare('SELECT slug FROM tenants WHERE id = ? LIMIT 1')
    .get(sessionTenantId) as { slug?: unknown } | undefined
  try {
    return normalizeConsoleTenantId(row?.slug, 'tenantId')
  } catch {
    return null
  }
}

function tenantAccessError(requestedTenantId: string, sessionTenantId: unknown): NextResponse | null {
  const ownedTenantId = resolveAuthenticatedTenantSlug(sessionTenantId)
  if (ownedTenantId === requestedTenantId) return null
  return NextResponse.json({ error: 'Forbidden tenant preferences access' }, { status: 403 })
}

function extractNotifications(value: unknown): NotificationPreferences {
  const raw = isRecord(value) ? value : {}
  return Object.fromEntries(
    NOTIFICATION_KEYS
      .filter(key => typeof raw[key] === 'boolean')
      .map(key => [key, raw[key]]),
  ) as NotificationPreferences
}

function extractTenantPreferences(config: unknown): TenantPreferences {
  const raw = isRecord(config) ? config : {}
  const preferences: TenantPreferences = {
    notifications: extractNotifications(raw.notifications),
  }
  const defaultModel = raw.default_model ?? raw.defaultModel
  if (typeof defaultModel === 'string' && defaultModel.trim()) {
    preferences.default_model = defaultModel.trim()
  }
  return preferences
}

function mergeTenantPreferences(current: TenantPreferences, patch: PreferencePatch): TenantPreferences {
  return {
    ...(current.default_model || patch.default_model
      ? { default_model: patch.default_model ?? current.default_model }
      : {}),
    notifications: {
      ...current.notifications,
      ...(patch.notifications || {}),
    },
  }
}

function buildTenantPreferenceWritePatch(current: TenantPreferences, patch: PreferencePatch): Partial<TenantPreferences> {
  const writePatch: Partial<TenantPreferences> = {}
  if (patch.default_model !== undefined) {
    writePatch.default_model = patch.default_model
  }
  if (patch.notifications !== undefined) {
    writePatch.notifications = {
      ...current.notifications,
      ...patch.notifications,
    }
  }
  return writePatch
}

function unwrapConfigPayload(payload: unknown): unknown {
  if (isRecord(payload) && isRecord(payload.config)) return payload.config
  return payload
}

function configUrl(tenantId: string): string {
  return `${resolveHarnessConsoleBaseUrl()}/api/console/tenant/${encodeURIComponent(tenantId)}/config`
}

async function fetchTenantConfig(tenantId: string): Promise<{ ok: true; config: unknown } | { ok: false; response: NextResponse }> {
  let upstream: Response
  try {
    upstream = await fetch(configUrl(tenantId), {
      method: 'GET',
      cache: 'no-store',
    })
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Failed to load tenant config' }, { status: 502 }) }
  }

  const payload = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        isRecord(payload) ? payload : { error: 'Failed to load tenant config' },
        { status: upstream.status },
      ),
    }
  }
  return { ok: true, config: unwrapConfigPayload(payload) }
}

function invalidPreferencesResponse(error: z.ZodError): NextResponse {
  const details = error.issues
    .map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ')
  return NextResponse.json({ error: `Invalid tenant preferences: ${details}` }, { status: 400 })
}

export async function GET(request: NextRequest, context: PreferencesRouteContext) {
  const auth = requireRole(request, 'customer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { tenantId: rawTenantId } = await routeParams(context.params)
    const tenantId = normalizeConsoleTenantId(rawTenantId)
    const accessError = tenantAccessError(tenantId, auth.user.tenant_id)
    if (accessError) return accessError

    const result = await fetchTenantConfig(tenantId)
    if (!result.ok) return result.response
    return NextResponse.json(extractTenantPreferences(result.config), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}

export async function PATCH(request: NextRequest, context: PreferencesRouteContext) {
  const auth = requireRole(request, 'customer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { tenantId: rawTenantId } = await routeParams(context.params)
    const tenantId = normalizeConsoleTenantId(rawTenantId)
    const accessError = tenantAccessError(tenantId, auth.user.tenant_id)
    if (accessError) return accessError

    const raw = await readJsonObject(request)
    const parsed = preferencePatchSchema.safeParse(raw)
    if (!parsed.success) return invalidPreferencesResponse(parsed.error)

    const currentResult = await fetchTenantConfig(tenantId)
    if (!currentResult.ok) return currentResult.response

    const currentPreferences = extractTenantPreferences(currentResult.config)
    const writePatch = buildTenantPreferenceWritePatch(currentPreferences, parsed.data)
    const nextPreferences = mergeTenantPreferences(currentPreferences, parsed.data)
    const upstream = await fetch(configUrl(tenantId), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(writePatch),
      cache: 'no-store',
    })
    const payload = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      return NextResponse.json(
        isRecord(payload) ? payload : { error: 'Failed to save tenant preferences' },
        { status: upstream.status },
      )
    }

    const responsePayload = unwrapConfigPayload(payload)
    const responsePreferences = isRecord(responsePayload) && ('default_model' in responsePayload || 'notifications' in responsePayload)
      ? extractTenantPreferences(responsePayload)
      : nextPreferences
    return NextResponse.json(responsePreferences, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
