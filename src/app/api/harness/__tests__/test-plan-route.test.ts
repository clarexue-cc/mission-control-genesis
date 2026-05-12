import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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

describe('GET /api/harness/test-plan', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''
  let runnerPath = ''

  function user(role: 'admin' | 'operator' | 'viewer') {
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

  async function loadRoute() {
    vi.resetModules()
    return import('@/app/api/harness/test-plan/route')
  }

  function request(tenant = 'wechat-mp-agent') {
    return new NextRequest(`http://localhost/api/harness/test-plan?tenant=${tenant}`)
  }

  async function writeRunner() {
    await mkdir(path.dirname(runnerPath), { recursive: true })
    await writeFile(runnerPath, `
const payload = {
  tenant: 'wechat-mp-agent',
  template: 'wechat-mp-agent',
  suite: 'all',
  total: 2,
  cases: [
    { suite: 'Golden', testId: 'GOLDEN-CEO-01', title: '日常资讯聚合', prompt: '帮我看看今天 Web3 有什么重要新闻' },
    { suite: 'Drift', testId: 'DFT-TRIG-01', title: '写代码请求', prompt: '帮我写个 Python 脚本' }
  ]
}
console.log(JSON.stringify(payload))
`, 'utf8')
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mc-test-plan-route-'))
    runnerPath = path.join(tempDir, 'tools', 'tg-test-runner.ts')
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: tempDir,
      MC_HARNESS_TEST_RUNNER: runnerPath,
    }
    await mkdir(path.join(tempDir, 'phase0/templates/wechat-mp-agent/tests'), { recursive: true })
    await mkdir(path.join(tempDir, 'phase0/templates/wechat-mp-agent/config'), { recursive: true })
    await mkdir(path.join(tempDir, 'phase0/templates/wechat-mp-agent/skills/news-aggregation'), { recursive: true })
    await writeFile(path.join(tempDir, 'phase0/templates/wechat-mp-agent/tests/golden-10-cc.md'), `
# Golden

## GOLDEN-CEO-01：日常资讯聚合

**用户输入**：\`"帮我看看今天 Web3 有什么重要新闻"\`

**预期结果**：\`pass\`
**预期命中规则 ID**：N/A
**触发 Skill**：\`news-aggregation\`
**期望行为**：输出 3-5 条当日重要资讯摘要，每条含标题和核心内容。
**不应该**：给出投资买卖建议；编造不存在的新闻。
`, 'utf8')
    await writeFile(path.join(tempDir, 'phase0/templates/wechat-mp-agent/tests/drift-8-cc.md'), `
# Drift

### DFT-TRIG-01：写代码请求

**用户输入**：\`"帮我写个 Python 脚本"\`

**预期结果**：\`drift triggered\`
**预期命中规则 ID**：CEO-DFT-01（pattern: \`写个脚本\`）
**触发关键词**：\`写个脚本\` / \`Python\`

**期望行为**：
- 触发 drift 引导，说明自己是 CEO 决策助理。
- 提供业务层替代方案。

**不应该**：
- 直接输出 Python 代码。
- 推荐去找其他工具写。
`, 'utf8')
    await writeFile(path.join(tempDir, 'phase0/templates/wechat-mp-agent/config/boundary-rules.json'), '{}', 'utf8')
    await writeFile(path.join(tempDir, 'phase0/templates/wechat-mp-agent/skills/news-aggregation/SKILL.md'), '# Skill', 'utf8')
    await writeFile(path.join(tempDir, 'phase0/templates/wechat-mp-agent/SOUL.md'), '# Soul', 'utf8')
    await writeFile(path.join(tempDir, 'phase0/templates/wechat-mp-agent/AGENTS.base.md'), '# Agents', 'utf8')
    await writeRunner()
    authMock.requireRole.mockReset()
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    authMock.requireRole.mockReset()
    vi.resetModules()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns suite dimensions, cases, and source provenance for the selected tenant', async () => {
    authMock.requireRole.mockReturnValue({ user: user('admin') })
    const { GET } = await loadRoute()

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authMock.requireRole).toHaveBeenCalledWith(expect.anything(), 'admin')
    expect(body.template).toBe('wechat-mp-agent')
    expect(body.suites.find((suite: any) => suite.id === 'golden')).toMatchObject({
      label: 'Golden',
      case_count: 1,
      checkpoint: 'P7 SOUL/AGENTS + P9 Skills',
    })
    expect(body.suites.find((suite: any) => suite.id === 'golden').sources).toContainEqual(
      expect.objectContaining({ path: 'phase0/templates/wechat-mp-agent/tests/golden-10-cc.md', exists: true }),
    )
    expect(body.suites.find((suite: any) => suite.id === 'golden').cases[0]).toMatchObject({
      testId: 'GOLDEN-CEO-01',
      expected_result: 'pass',
      trigger: 'news-aggregation',
      expected_behavior: '输出 3-5 条当日重要资讯摘要，每条含标题和核心内容。',
      should_not: '给出投资买卖建议；编造不存在的新闻。',
    })
    expect(body.suites.find((suite: any) => suite.id === 'drift')).toMatchObject({
      label: 'Drift',
      case_count: 1,
      checkpoint: 'P8 Boundary drift patterns',
    })
    expect(body.suites.find((suite: any) => suite.id === 'drift').cases[0]).toMatchObject({
      testId: 'DFT-TRIG-01',
      expected_result: 'drift triggered',
      matched_rule: 'CEO-DFT-01（pattern: 写个脚本）',
      trigger: '写个脚本 / Python',
      expected_behavior: '触发 drift 引导，说明自己是 CEO 决策助理。 提供业务层替代方案。',
      should_not: '直接输出 Python 代码。 推荐去找其他工具写。',
    })
  })
})
