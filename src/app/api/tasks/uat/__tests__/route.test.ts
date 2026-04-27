import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('server-only', () => ({}))

const adminUser = {
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

const customerUser = {
  ...adminUser,
  username: 'customer-operator',
  display_name: 'Customer Operator',
  role: 'viewer',
}

function request(url: string, method = 'GET', body?: Record<string, unknown>) {
  return new NextRequest(url, {
    method,
    ...(body ? {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    } : {}),
  })
}

async function loadRoutes() {
  vi.resetModules()
  const uat = await import('@/app/api/tasks/uat/route')
  const submit = await import('@/app/api/tasks/uat/[id]/submit/route')
  const submissions = await import('@/app/api/tasks/uat/[id]/submissions/route')
  return { uat, submit, submissions }
}

describe('/api/tasks/uat', () => {
  const originalEnv = { ...process.env }
  let harnessRoot = ''

  beforeEach(async () => {
    harnessRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-uat-'))
    await mkdir(path.join(harnessRoot, 'phase0', 'tenants'), { recursive: true })
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: harnessRoot,
    }
    authMock.requireRole.mockReset()
    authMock.requireRole.mockReturnValue({ user: adminUser })
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(harnessRoot, { recursive: true, force: true })
  })

  async function createTask(tenantId = 'tenant-a', title = 'Approve media brief') {
    authMock.requireRole.mockReturnValue({ user: adminUser })
    const { uat } = await loadRoutes()
    const response = await uat.POST(request('http://localhost/api/tasks/uat', 'POST', {
      tenant_id: tenantId,
      title,
      description: '请验收本周媒体情报简报。',
    }))
    const body = await response.json()
    return { response, body, task: body.task }
  }

  it('lets admin create a UAT task and writes uat-tasks.jsonl', async () => {
    const { response, body, task } = await createTask('tenant-a')

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(task.title).toBe('Approve media brief')
    expect(task.tenant_id).toBe('tenant-a')
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.any(NextRequest), 'admin')

    const filePath = path.join(harnessRoot, 'phase0', 'tenants', 'tenant-a', 'uat-tasks.jsonl')
    await expect(stat(filePath)).resolves.toBeTruthy()
    await expect(readFile(filePath, 'utf8')).resolves.toContain(task.id)
  })

  it('rejects non-admin task creation', async () => {
    authMock.requireRole.mockReturnValue({ error: 'Requires admin role or higher', status: 403 })
    const { uat } = await loadRoutes()

    const response = await uat.POST(request('http://localhost/api/tasks/uat', 'POST', {
      tenant_id: 'tenant-a',
      title: 'Blocked task',
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Requires admin')
  })

  it('lets customer list only their tenant tasks', async () => {
    await createTask('tenant-a', 'Tenant A task')
    await createTask('tenant-b', 'Tenant B task')
    authMock.requireRole.mockReturnValue({ user: customerUser })
    const { uat } = await loadRoutes()

    const response = await uat.GET(request('http://localhost/api/tasks/uat?role=customer&tenant_id=tenant-a'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]).toMatchObject({ tenant_id: 'tenant-a', title: 'Tenant A task' })
    expect(JSON.stringify(body.tasks)).not.toContain('Tenant B task')
    expect(authMock.requireRole).toHaveBeenLastCalledWith(expect.any(NextRequest), 'viewer')
  })

  it('lets customer submit feedback', async () => {
    const { task } = await createTask('tenant-a')
    authMock.requireRole.mockReturnValue({ user: customerUser })
    const { submit } = await loadRoutes()

    const response = await submit.POST(
      request(`http://localhost/api/tasks/uat/${task.id}/submit?role=customer`, 'POST', {
        tenant_id: 'tenant-a',
        response_text: '简报内容准确，可以上线。',
        feedback_options: ['结果正确', '可以上线'],
        feedback_notes: '建议下次补充竞品截图。',
        rating: 5,
      }),
      { params: Promise.resolve({ id: task.id }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.submission).toMatchObject({
      task_id: task.id,
      tenant_id: 'tenant-a',
      submitted_by: 'customer-operator',
      rating: 5,
    })
  })

  it('blocks non-customer view from customer submit endpoint', async () => {
    const { task } = await createTask('tenant-a')
    authMock.requireRole.mockReturnValue({ user: adminUser })
    const { submit } = await loadRoutes()

    const response = await submit.POST(
      request(`http://localhost/api/tasks/uat/${task.id}/submit`, 'POST', {
        tenant_id: 'tenant-a',
        response_text: 'Trying from admin view',
        rating: 4,
      }),
      { params: Promise.resolve({ id: task.id }) },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('customer view')
  })

  it('lets admin read submissions for a task', async () => {
    const { task } = await createTask('tenant-a')
    authMock.requireRole.mockReturnValue({ user: customerUser })
    const { submit, submissions } = await loadRoutes()
    await submit.POST(
      request(`http://localhost/api/tasks/uat/${task.id}/submit?role=customer`, 'POST', {
        tenant_id: 'tenant-a',
        response_text: '已验收。',
        feedback_options: ['内容有帮助'],
        feedback_notes: '无',
        rating: 4,
      }),
      { params: Promise.resolve({ id: task.id }) },
    )

    authMock.requireRole.mockReturnValue({ user: adminUser })
    const response = await submissions.GET(
      request(`http://localhost/api/tasks/uat/${task.id}/submissions?tenant_id=tenant-a`),
      { params: Promise.resolve({ id: task.id }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.submissions).toHaveLength(1)
    expect(body.submissions[0].rating).toBe(4)
    expect(authMock.requireRole).toHaveBeenLastCalledWith(expect.any(NextRequest), 'admin')
  })

  it('rejects tenant traversal with TENANT_ID_RE validation', async () => {
    const { uat } = await loadRoutes()
    const response = await uat.POST(request('http://localhost/api/tasks/uat', 'POST', {
      tenant_id: '../tenant-a',
      title: 'Traversal attempt',
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('Tenant ID')
  })

  it('returns 404 when submitting feedback to a missing task', async () => {
    authMock.requireRole.mockReturnValue({ user: customerUser })
    const { submit } = await loadRoutes()

    const response = await submit.POST(
      request('http://localhost/api/tasks/uat/missing-task/submit?role=customer', 'POST', {
        tenant_id: 'tenant-a',
        response_text: 'No task here',
        rating: 3,
      }),
      { params: Promise.resolve({ id: 'missing-task' }) },
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toContain('not found')
  })
})
