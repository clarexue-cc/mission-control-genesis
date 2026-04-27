import { File as NodeFile } from 'node:buffer'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: authMock.requireRole,
}))

vi.mock('@/lib/harness-boundary', () => ({
  resolveHarnessRoot: async () => process.env.MC_HARNESS_ROOT,
}))

describe('POST /api/onboarding/customer/intake', () => {
  const originalEnv = { ...process.env }
  let harnessRoot = ''

  function adminUser() {
    return {
      id: 1,
      username: 'clare-admin',
      display_name: 'Clare Admin',
      role: 'admin',
      workspace_id: 1,
      tenant_id: 1,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
    }
  }

  async function loadPost() {
    vi.resetModules()
    const route = await import('@/app/api/onboarding/customer/intake/route')
    return route.POST
  }

  function request(formData: FormData) {
    return {
      formData: async () => formData,
      url: 'http://localhost/api/onboarding/customer/intake',
      headers: new Headers(),
    } as unknown as NextRequest
  }

  function baseForm(file: File, overrides: Record<string, string> = {}) {
    const fields = new Map<string, FormDataEntryValue>([
      ['tenant_id', overrides.tenant_id || 'demo-dry-run-2'],
      ['tenant_name', overrides.tenant_name || 'Demo Dry Run 2'],
      ['summary', overrides.summary || 'demo summary'],
      ['file', file],
    ])
    return {
      get: (key: string) => fields.get(key) ?? null,
    } as unknown as FormData
  }

  beforeEach(async () => {
    harnessRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-ob-s1-'))
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: harnessRoot,
    }
    authMock.requireRole.mockReset()
    authMock.requireRole.mockReturnValue({ user: adminUser() })
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(harnessRoot, { recursive: true, force: true })
  })

  it('accepts text uploads, writes phase0 tenant vault, and returns markdown preview', async () => {
    const POST = await loadPost()
    const file = new NodeFile(['客户原话：请生成日报。\n正例：结构清楚。'], 'interview.md', { type: 'text/markdown' }) as unknown as File

    const response = await POST(request(baseForm(file)))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.path).toBe('phase0/tenants/demo-dry-run-2/vault/intake-raw.md')
    expect(body.content).toContain('# Intake Raw')
    expect(body.content).toContain('客户原话：请生成日报。')
    expect(body.content).toContain('clare-admin')

    const physicalPath = path.join(harnessRoot, 'phase0/tenants/demo-dry-run-2/vault/intake-raw.md')
    await expect(stat(physicalPath)).resolves.toBeTruthy()
    await expect(readFile(physicalPath, 'utf8')).resolves.toContain('interview.md')
  })

  it('accepts audio uploads and records a transcription pending placeholder', async () => {
    const POST = await loadPost()
    const file = new NodeFile([new Uint8Array([1, 2, 3])], 'interview.mp3', { type: 'audio/mpeg' }) as unknown as File

    const response = await POST(request(baseForm(file)))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.content).toContain('录音转文字暂未实现')
    expect(body.content).toContain('[audio-upload]')
  })

  it('rejects unsupported file types', async () => {
    const POST = await loadPost()
    const file = new NodeFile(['{}'], 'payload.json', { type: 'application/json' }) as unknown as File

    const response = await POST(request(baseForm(file)))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('audio/* or text/*')
  })
})
