import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

const dbMock = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  prepare: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbMock.getDatabase,
}))

describe('Harness agent preferences route', () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  function user(role: 'admin' | 'operator' | 'viewer' | 'customer-admin') {
    return {
      id: 1,
      username: role,
      display_name: role,
      role,
      workspace_id: 1,
      tenant_id: 1,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
    }
  }

  function jsonResponse(body: unknown, init?: ResponseInit) {
    return new Response(JSON.stringify(body), {
      status: init?.status || 200,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers || {}),
      },
    })
  }

  function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
    return new NextRequest(url, init)
  }

  beforeEach(() => {
    vi.resetModules()
    authMock.requireRole.mockReset()
    authMock.requireRole.mockReturnValue({ user: user('customer-admin') })
    dbMock.get.mockReset()
    dbMock.prepare.mockReset()
    dbMock.getDatabase.mockReset()
    dbMock.prepare.mockImplementation(() => ({ get: dbMock.get }))
    dbMock.get.mockImplementation((name: string, workspaceId: number) => (
      name === 'chief-of-staff' && workspaceId === 1
        ? { name: 'chief-of-staff' }
        : undefined
    ))
    dbMock.getDatabase.mockReturnValue({ prepare: dbMock.prepare })
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    process.env = {
      ...originalEnv,
      MC_HARNESS_CONSOLE_URL: 'http://harness.local:3088',
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
  })

  it('loads customer preferences from nested agent config', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      model: { primary: 'gpt-5.4' },
      preferences: {
        tone: 'warm',
        language: 'en-US',
        response_length: 'brief',
      },
    }))
    const { GET } = await import('@/app/api/harness/agents/[name]/preferences/route')

    const response = await GET(request('http://localhost/api/harness/agents/chief-of-staff/preferences'), {
      params: Promise.resolve({ name: 'chief-of-staff' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'customer-admin')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/agents/chief-of-staff/config',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(body).toEqual({
      tone: 'warm',
      language: 'en-US',
      response_length: 'brief',
    })
  })

  it('falls back to supported defaults when upstream returns unsupported preference values', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      preferences: {
        tone: 'experimental',
        language: 'fr-FR',
        response_length: 'ultra',
      },
    }))
    const { GET } = await import('@/app/api/harness/agents/[name]/preferences/route')

    const response = await GET(request('http://localhost/api/harness/agents/chief-of-staff/preferences'), {
      params: Promise.resolve({ name: 'chief-of-staff' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      tone: 'professional',
      language: 'zh-CN',
      response_length: 'balanced',
    })
  })

  it('rejects agents outside the authenticated workspace before proxying', async () => {
    const { GET } = await import('@/app/api/harness/agents/[name]/preferences/route')

    const response = await GET(request('http://localhost/api/harness/agents/unknown/preferences'), {
      params: Promise.resolve({ name: 'unknown' }),
    })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('Agent not found')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid preference payloads before proxying writes', async () => {
    const { PUT } = await import('@/app/api/harness/agents/[name]/preferences/route')

    const response = await PUT(request('http://localhost/api/harness/agents/chief-of-staff/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tone: 'warm', language: 'en-US', response_length: 'brief', extra: 'nope' }),
    }), {
      params: Promise.resolve({ name: 'chief-of-staff' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid preferences payload')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps upstream transport failures to a sanitized 502 response', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3088'))
    const { GET } = await import('@/app/api/harness/agents/[name]/preferences/route')

    const response = await GET(request('http://localhost/api/harness/agents/chief-of-staff/preferences'), {
      params: Promise.resolve({ name: 'chief-of-staff' }),
    })
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.error).toBe('Failed to load preferences')
  })

  it('proxies validated preferences writes to the harness console config endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ saved: true }))
    const { PUT } = await import('@/app/api/harness/agents/[name]/preferences/route')

    const payload = {
      tone: 'direct',
      language: 'bilingual',
      response_length: 'detailed',
    }
    const response = await PUT(request('http://localhost/api/harness/agents/chief-of-staff/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }), {
      params: Promise.resolve({ name: 'chief-of-staff' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://harness.local:3088/api/console/agents/chief-of-staff/config',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ preferences: payload }),
      }),
    )
    expect(body).toEqual({
      ok: true,
      preferences: payload,
    })
  })

  it('treats upstream 204 saves as a successful JSON response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const { PUT } = await import('@/app/api/harness/agents/[name]/preferences/route')

    const payload = {
      tone: 'warm',
      language: 'zh-CN',
      response_length: 'balanced',
    }
    const response = await PUT(request('http://localhost/api/harness/agents/chief-of-staff/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }), {
      params: Promise.resolve({ name: 'chief-of-staff' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      preferences: payload,
    })
  })
})
