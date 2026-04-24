import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { syncAgentsFromConfig, previewSyncDiff } from '@/lib/agent-sync'
import { syncLocalAgents } from '@/lib/local-agent-sync'
import { logger } from '@/lib/logger'

/**
 * POST /api/agents/sync - Trigger agent config sync
 * ?source=local triggers local disk scan instead of openclaw.json sync.
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const source = searchParams.get('source')
  let gatewayId: number | null = null
  try {
    const body = await request.json()
    if (body?.gatewayId != null) {
      const parsedGatewayId = Number(body.gatewayId)
      if (!Number.isInteger(parsedGatewayId) || parsedGatewayId < 1) {
        return NextResponse.json({ error: 'gatewayId must be a positive integer' }, { status: 400 })
      }
      gatewayId = parsedGatewayId
    }
  } catch {
    // Body is optional for the existing "sync all" behavior.
  }

  try {
    if (source === 'local') {
      const result = await syncLocalAgents()
      return NextResponse.json(result)
    }

    const result = await syncAgentsFromConfig(auth.user.username, { gatewayId })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/agents/sync error')
    return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 })
  }
}

/**
 * GET /api/agents/sync - Preview diff between openclaw.json and MC
 * Shows what would change without writing.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const gatewayIdParam = request.nextUrl.searchParams.get('gatewayId')
    let gatewayId: number | null = null
    if (gatewayIdParam) {
      const parsedGatewayId = Number(gatewayIdParam)
      if (!Number.isInteger(parsedGatewayId) || parsedGatewayId < 1) {
        return NextResponse.json({ error: 'gatewayId must be a positive integer' }, { status: 400 })
      }
      gatewayId = parsedGatewayId
    }
    const diff = await previewSyncDiff({ gatewayId })
    return NextResponse.json(diff)
  } catch (error: any) {
    logger.error({ err: error }, 'GET /api/agents/sync error')
    return NextResponse.json({ error: error.message || 'Preview failed' }, { status: 500 })
  }
}
