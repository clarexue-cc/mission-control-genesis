import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import {
  computeBoundaryRulesHash,
  deleteBoundaryRulesFile,
  finalizeBoundaryRulesUpdate,
  normalizeBoundaryTenant,
  readBoundaryRulesFile,
  readBoundaryRulesState,
  writeBoundaryRulesFile,
} from '@/lib/harness-boundary'
import { parseBoundaryRulesRaw, stringifyBoundaryRules } from '@/lib/harness-boundary-schema'
import { mutationLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const requestSchema = z.object({
  tenant: z.string().min(1),
  content: z.string().min(1, 'content is required'),
  hash: z.string().min(1).optional(),
})

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Invalid request body' }, { status: 400 })
  }

  let tenant
  try {
    tenant = normalizeBoundaryTenant(body.tenant)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Invalid tenant' }, { status: 400 })
  }

  let normalizedRaw: string
  try {
    normalizedRaw = stringifyBoundaryRules(parseBoundaryRulesRaw(body.content))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Boundary rules validation failed' }, { status: 400 })
  }

  const currentState = await readBoundaryRulesState(tenant)
  if (body.hash && currentState.hash && body.hash !== currentState.hash) {
    return NextResponse.json(
      { error: 'Boundary rules changed on disk. Refresh the panel and try again.' },
      { status: 409 },
    )
  }

  if (!currentState.writable) {
    return NextResponse.json(
      { error: 'Mission Control cannot write this boundary-rules.json file.' },
      { status: 409 },
    )
  }

  const previousRaw = await readBoundaryRulesFile(tenant)
  try {
    await writeBoundaryRulesFile(tenant, normalizedRaw)
    const finalize = await finalizeBoundaryRulesUpdate(tenant, normalizedRaw)
    const hash = computeBoundaryRulesHash(normalizedRaw)

    try {
      const db = getDatabase()
      db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run(
        'harness_boundary_rules_update',
        auth.user?.username || 'system',
        `Updated ${tenant} boundary-rules.json (${finalize.method}) hash=${hash}`,
      )
    } catch {
      // Non-critical: keep update flow working even if audit logging is unavailable.
    }

    return NextResponse.json({
      success: true,
      tenant,
      method: finalize.method,
      latency_ms: finalize.latency_ms,
      hash,
      note: finalize.note,
    })
  } catch (error: any) {
    if (previousRaw !== null) {
      await writeBoundaryRulesFile(tenant, previousRaw).catch(() => {})
    } else {
      await deleteBoundaryRulesFile(tenant).catch(() => {})
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to apply boundary rules update' },
      { status: 500 },
    )
  }
}
