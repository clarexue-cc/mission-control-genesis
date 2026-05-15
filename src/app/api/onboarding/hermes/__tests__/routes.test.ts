import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

describe('Hermes onboarding file APIs', () => {
  const originalEnv = { ...process.env }
  const tenantId = 'media-intel-agent'
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

  function request(pathname: string) {
    return new NextRequest(`http://localhost${pathname}?tenant_id=${tenantId}`)
  }

  async function writeTenantFile(relativePath: string, content: string) {
    const fullPath = path.join(harnessRoot, 'phase0/tenants', tenantId, relativePath)
    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf8')
  }

  beforeEach(async () => {
    harnessRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-hermes-api-'))
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: harnessRoot,
    }
    authMock.requireRole.mockReset()
    authMock.requireRole.mockReturnValue({ user: adminUser() })

    await writeTenantFile('vault/intake-analysis.md', '# Blueprint\n\nHermes media intel blueprint.')
    await writeTenantFile('profile/profile-vars.json', JSON.stringify({ tenant_slug: tenantId, base: 'hermes' }, null, 2))
    await writeTenantFile('profile/USER.md', '# USER\n\nVinson media operation profile.')
    await writeTenantFile('profile/identity/config.yaml', 'base: hermes\nmodel: gpt-5\n')
    await writeTenantFile('config/harness-meta.json', JSON.stringify({ tenant_id: tenantId }, null, 2))
    await writeTenantFile('config/hermes.json', JSON.stringify({ gateway: 'enabled' }, null, 2))
    await writeTenantFile('profile/cron-schedule.yaml', 'competitor-scan: "0 2 * * *"\n')
    await writeTenantFile('profile/approved-skills.json', JSON.stringify({ approved: ['competitor-scan'] }, null, 2))
    await writeTenantFile('config/boundary-rules.json', JSON.stringify({ rules: ['public-data-only'] }, null, 2))
    for (const skill of ['competitor-scan', 'trending-filter', 'user-demand-collect', 'low-fan-discovery', 'industry-scan']) {
      await writeTenantFile(`profile/skills/${skill}/SKILL.md`, `# ${skill}\n\nHermes skill.`)
    }
    await writeTenantFile('vault/Agent-情报搜集/working-context.md', '# Context')
    await writeTenantFile('vault/Agent-Shared/project-state.md', '# Project State')
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(harnessRoot, { recursive: true, force: true })
  })

  it('loads H1 blueprint files', async () => {
    const { GET } = await import('@/app/api/onboarding/hermes/blueprint/route')

    const response = await GET(request('/api/onboarding/hermes/blueprint'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.tenant_id).toBe(tenantId)
    expect(body.blueprint.content).toContain('Hermes media intel blueprint')
    expect(body.profile_vars.json.base).toBe('hermes')
    expect(body.user_profile.content).toContain('Vinson')
  })

  it('loads H3 deploy config and vault entries', async () => {
    const { GET } = await import('@/app/api/onboarding/hermes/deploy/route')

    const response = await GET(request('/api/onboarding/hermes/deploy'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.files.identity_config.content).toContain('base: hermes')
    expect(body.files.harness_meta.content).toContain(tenantId)
    expect(body.files.hermes.content).toContain('gateway')
    expect(body.vault.agent_intel_files).toContain('working-context.md')
    expect(body.vault.agent_shared_files).toContain('project-state.md')
  })

  it('loads H5 skills with cron and approved skill governance', async () => {
    const { GET } = await import('@/app/api/onboarding/hermes/skills/route')

    const response = await GET(request('/api/onboarding/hermes/skills'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.skills).toHaveLength(5)
    expect(body.skills.map((skill: { id: string }) => skill.id)).toContain('competitor-scan')
    expect(body.governance.cron_schedule.content).toContain('competitor-scan')
    expect(body.governance.approved_skills.content).toContain('approved')
  })

  it('loads H6 governance config files', async () => {
    const { GET } = await import('@/app/api/onboarding/hermes/governance-config/route')

    const response = await GET(request('/api/onboarding/hermes/governance-config'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.files.boundary_rules.content).toContain('public-data-only')
    expect(body.files.cron_schedule.content).toContain('competitor-scan')
    expect(body.files.approved_skills.content).toContain('approved')
  })
})
