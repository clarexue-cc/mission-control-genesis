import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import {
  buildGatewayProcessEnv,
  getRegisteredGatewayById,
  listRegisteredGateways,
  resolveGatewayConfigSource,
  type GatewayRecord,
} from '@/lib/gateway-registry'

const GATEWAY_TIMEOUT = 5000

function buildGatewayHttpUrl(gateway: GatewayRecord, endpointPath: string): string | null {
  const rawHost = String(gateway.host || '').trim()
  if (!rawHost) return null
  const hasProtocol =
    rawHost.startsWith('http://') ||
    rawHost.startsWith('https://') ||
    rawHost.startsWith('ws://') ||
    rawHost.startsWith('wss://')

  try {
    if (hasProtocol) {
      const parsed = new URL(rawHost)
      if (parsed.protocol === 'ws:') parsed.protocol = 'http:'
      if (parsed.protocol === 'wss:') parsed.protocol = 'https:'
      if (!parsed.port && gateway.port) parsed.port = String(gateway.port)
      parsed.pathname = endpointPath
      return parsed.toString()
    }
    return `http://${rawHost}:${gateway.port}${endpointPath}`
  } catch {
    return null
  }
}

/** Probe a registered gateway's HTTP health endpoints to check reachability. */
async function isGatewayReachable(gateway: GatewayRecord): Promise<boolean> {
  for (const endpointPath of ['/healthz', '/health', '/api/health']) {
    const url = buildGatewayHttpUrl(gateway, endpointPath)
    if (!url) continue

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (res.ok) return true
    } catch {
      // Try the next compatible health path.
    } finally {
      clearTimeout(timeout)
    }
  }
  return false
}

function selectGateways(gatewayId: number | null): { gateways: GatewayRecord[]; error?: string; status?: number } {
  if (gatewayId != null) {
    const gateway = getRegisteredGatewayById(gatewayId)
    if (!gateway) return { gateways: [], error: `Gateway ${gatewayId} not found`, status: 404 }
    return { gateways: [gateway] }
  }
  return { gateways: listRegisteredGateways() }
}

function parseGatewayId(request: NextRequest, body?: Record<string, unknown>): number | null | 'invalid' {
  const raw = body?.gatewayId ?? request.nextUrl.searchParams.get('gatewayId')
  if (raw == null || raw === '') return null
  const gatewayId = Number(raw)
  if (!Number.isInteger(gatewayId) || gatewayId < 1) return 'invalid'
  return gatewayId
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const action = request.nextUrl.searchParams.get('action') || 'list'
  const gatewayId = parseGatewayId(request)
  if (gatewayId === 'invalid') {
    return NextResponse.json({ error: 'gatewayId must be a positive integer' }, { status: 400 })
  }
  const selection = selectGateways(gatewayId)
  if (selection.error) {
    return NextResponse.json({ error: selection.error }, { status: selection.status || 400 })
  }

  if (action === 'list') {
    const nodes: unknown[] = []
    const gateways: Array<{ gatewayId: number; name: string; connected: boolean; nodes: number }> = []

    for (const gateway of selection.gateways) {
      const connected = await isGatewayReachable(gateway)
      if (!connected) {
        gateways.push({ gatewayId: gateway.id, name: gateway.name, connected: false, nodes: 0 })
        continue
      }

      try {
        const source = resolveGatewayConfigSource(gateway)
        const data = await callOpenClawGateway<{ nodes?: unknown[] }>('node.list', {}, {
          timeoutMs: GATEWAY_TIMEOUT,
          env: buildGatewayProcessEnv(gateway, source),
        })
        const gatewayNodes = Array.isArray(data?.nodes) ? data.nodes : []
        nodes.push(...gatewayNodes.map((node) => (
          node && typeof node === 'object' && !Array.isArray(node)
            ? { gatewayId: gateway.id, gatewayName: gateway.name, ...(node as Record<string, unknown>) }
            : node
        )))
        gateways.push({ gatewayId: gateway.id, name: gateway.name, connected: true, nodes: gatewayNodes.length })
      } catch (rpcErr) {
        // Gateway is reachable but openclaw CLI unavailable (e.g. Docker) or
        // node.list not supported — return connected=true with empty node list
        logger.warn({ err: rpcErr, gateway: gateway.name }, 'node.list RPC failed, returning empty node list')
        gateways.push({ gatewayId: gateway.id, name: gateway.name, connected: true, nodes: 0 })
      }
    }

    return NextResponse.json({
      nodes,
      connected: gateways.some((gateway) => gateway.connected),
      gateways,
    })
  }

  if (action === 'devices') {
    const devices: unknown[] = []
    const gateways: Array<{ gatewayId: number; name: string; connected: boolean; devices: number }> = []

    for (const gateway of selection.gateways) {
      const connected = await isGatewayReachable(gateway)
      if (!connected) {
        gateways.push({ gatewayId: gateway.id, name: gateway.name, connected: false, devices: 0 })
        continue
      }

      try {
        const data = await callOpenClawGateway<{ devices?: unknown[] }>(
          'device.pair.list',
          {},
          {
            timeoutMs: GATEWAY_TIMEOUT,
            env: buildGatewayProcessEnv(gateway, resolveGatewayConfigSource(gateway)),
          },
        )
        const gatewayDevices = Array.isArray(data?.devices) ? data.devices : []
        devices.push(...gatewayDevices.map((device) => (
          device && typeof device === 'object' && !Array.isArray(device)
            ? { gatewayId: gateway.id, gatewayName: gateway.name, ...(device as Record<string, unknown>) }
            : device
        )))
        gateways.push({ gatewayId: gateway.id, name: gateway.name, connected: true, devices: gatewayDevices.length })
      } catch (rpcErr) {
        logger.warn({ err: rpcErr, gateway: gateway.name }, 'device.pair.list RPC failed, returning empty device list')
        gateways.push({ gatewayId: gateway.id, name: gateway.name, connected: true, devices: 0 })
      }
    }

    return NextResponse.json({ devices, gateways })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}

const VALID_DEVICE_ACTIONS = ['approve', 'reject', 'rotate-token', 'revoke-token'] as const
type DeviceAction = (typeof VALID_DEVICE_ACTIONS)[number]

/** Map UI action names to gateway RPC method names and their required param keys. */
const ACTION_RPC_MAP: Record<DeviceAction, { method: string; paramKey: 'requestId' | 'deviceId' }> = {
  'approve':      { method: 'device.pair.approve', paramKey: 'requestId' },
  'reject':       { method: 'device.pair.reject',  paramKey: 'requestId' },
  'rotate-token': { method: 'device.token.rotate',  paramKey: 'deviceId' },
  'revoke-token': { method: 'device.token.revoke',  paramKey: 'deviceId' },
}

/**
 * POST /api/nodes - Device management actions
 * Body: { action: DeviceAction, requestId?: string, deviceId?: string, role?: string, scopes?: string[] }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const gatewayId = parseGatewayId(request, body)
  if (gatewayId === 'invalid') {
    return NextResponse.json({ error: 'gatewayId must be a positive integer' }, { status: 400 })
  }
  const selection = selectGateways(gatewayId)
  if (selection.error) {
    return NextResponse.json({ error: selection.error }, { status: selection.status || 400 })
  }
  const gateway = selection.gateways.find((item) => item.is_primary === 1) || selection.gateways[0]
  if (!gateway) {
    return NextResponse.json({ error: 'No gateway configured' }, { status: 400 })
  }

  const action = body.action as string
  if (!action || !VALID_DEVICE_ACTIONS.includes(action as DeviceAction)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${VALID_DEVICE_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  const spec = ACTION_RPC_MAP[action as DeviceAction]

  // Validate required param
  const id = body[spec.paramKey] as string | undefined
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: `Missing required field: ${spec.paramKey}` }, { status: 400 })
  }

  // Build RPC params
  const params: Record<string, unknown> = { [spec.paramKey]: id }
  if ((action === 'rotate-token' || action === 'revoke-token') && body.role) {
    params.role = body.role
  }
  if (action === 'rotate-token' && Array.isArray(body.scopes)) {
    params.scopes = body.scopes
  }

  try {
    const result = await callOpenClawGateway(spec.method, params, {
      timeoutMs: GATEWAY_TIMEOUT,
      env: buildGatewayProcessEnv(gateway, resolveGatewayConfigSource(gateway)),
    })
    return NextResponse.json(result)
  } catch (err: unknown) {
    logger.error({ err }, 'Gateway device action failed')
    return NextResponse.json({ error: 'Gateway device action failed' }, { status: 502 })
  }
}
