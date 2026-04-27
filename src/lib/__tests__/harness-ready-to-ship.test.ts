import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  evaluateRuntime,
  getReadyToShipReport,
  getRuntimeHealthTarget,
  type ReadyToShipCheckRule,
} from '@/lib/harness-ready-to-ship'

const TENANT = 'media-intel-v1'

function rule(id: string, name: string): ReadyToShipCheckRule {
  return {
    check_id: id,
    check_name: name,
    severity: id === 'RTS-10' ? 'high' : 'critical',
    category: id === 'RTS-05' || id === 'RTS-06' || id === 'RTS-08' || id === 'RTS-09' ? 'testing' : 'runtime',
    check_method: id === 'RTS-07' ? 'log_scan' : id.startsWith('RTS-0') ? 'api_call' : 'test_run',
    expected: `${id} expected`,
    fail_hint: `${id} hint`,
    blocker_for_ship: true,
  }
}

async function writeFixtureHarness(root: string) {
  await mkdir(path.join(root, 'phase0/templates/delivery-checklist'), { recursive: true })
  await mkdir(path.join(root, `phase0/templates/${TENANT}/config`), { recursive: true })
  await mkdir(path.join(root, `phase0/templates/${TENANT}/tenant`), { recursive: true })
  await mkdir(path.join(root, `phase0/templates/${TENANT}/skills/media-monitor`), { recursive: true })
  await mkdir(path.join(root, `phase0/templates/${TENANT}/tests`), { recursive: true })
  await mkdir(path.join(root, 'phase0/templates/customer-view'), { recursive: true })
  await mkdir(path.join(root, `phase0/tenants/${TENANT}`), { recursive: true })

  await writeFile(path.join(root, 'phase0/templates/delivery-checklist/ready-to-ship-rules.json'), JSON.stringify({
    version: 'test',
    last_updated: '2026-04-27',
    checks: [
      rule('RTS-01', 'OpenClaw 运行健康'),
      rule('RTS-02', 'LLM Proxy 预算配置'),
      rule('RTS-03', 'boundary-rules.json 已加载'),
      rule('RTS-04', 'Skill 已注入'),
      rule('RTS-05', 'Golden 测试 100% 通过'),
      rule('RTS-06', 'Adversarial 失败率 ≤ 5%'),
      rule('RTS-07', '边界违反次数 = 0'),
      rule('RTS-08', '跨 Session 测试 3 条通过'),
      rule('RTS-09', 'Drift 测试全部按预期'),
      rule('RTS-10', '客户视图 RBAC 已配置'),
    ],
  }), 'utf8')

  const forbidden = Array.from({ length: 5 }, (_, index) => ({
    id: `F-${index}`,
    category: 'safety',
    patterns: [`forbidden-${index}`],
    pattern: `forbidden-${index}`,
    label: `Forbidden ${index}`,
    severity: 'high',
    action: 'block',
    response_template: 'blocked',
  }))
  const drift = Array.from({ length: 3 }, (_, index) => ({
    id: `D-${index}`,
    category: 'quality',
    pattern: `drift-${index}`,
  }))
  await writeFile(path.join(root, `phase0/templates/${TENANT}/config/boundary-rules.json`), JSON.stringify({
    version: '1.0',
    last_updated: '2026-04-27',
    forbidden_patterns: forbidden,
    drift_patterns: drift,
  }), 'utf8')

  await writeFile(path.join(root, `phase0/templates/${TENANT}/tenant/vars.json`), JSON.stringify({ daily_budget_usd: 25 }), 'utf8')
  await writeFile(path.join(root, `phase0/templates/${TENANT}/SOUL.md`), '# SOUL\n\nagent\n', 'utf8')
  await writeFile(path.join(root, `phase0/templates/${TENANT}/AGENTS.base.md`), '# AGENTS\n\nagent\n', 'utf8')
  await writeFile(
    path.join(root, `phase0/templates/${TENANT}/skills/media-monitor/SKILL.md`),
    Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n'),
    'utf8',
  )
  await writeFile(path.join(root, 'phase0/templates/customer-view/copy-zh-CN.json'), JSON.stringify({ replacement_terms: { agent: 'AI 助手' } }), 'utf8')

  const suiteCounts: Record<string, number> = {
    'golden-10-cc.md': 10,
    'adversarial-20-cc.md': 20,
    'cross-session-3-cc.md': 3,
    'drift-6-cc.md': 6,
  }
  for (const [file, count] of Object.entries(suiteCounts)) {
    await writeFile(
      path.join(root, `phase0/templates/${TENANT}/tests/${file}`),
      Array.from({ length: count }, (_, index) => `case ${index}\n**预期结果** pass`).join('\n'),
      'utf8',
    )
  }
}

describe('harness ready-to-ship runtime fallback', () => {
  const originalEnv = { ...process.env }
  let tempRoot = ''

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-rts-'))
    await writeFixtureHarness(tempRoot)
    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: tempRoot,
      MC_RTS_HEALTH_URL: '',
    }
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('uses mock fallback when MC_RTS_HEALTH_URL is missing or partial', () => {
    expect(getRuntimeHealthTarget({}).mode).toBe('mock-fallback')
    expect(getRuntimeHealthTarget({ MC_RTS_HEALTH_URL: '127.0.0.1:3002/healthz' }).mode).toBe('mock-fallback')
    expect(getRuntimeHealthTarget({ MC_RTS_HEALTH_URL: 'http://127.0.0.1:3002/healthz' })).toMatchObject({
      mode: 'full',
      url: 'http://127.0.0.1:3002/healthz',
    })
  })

  it('returns RTS-01 pass in mock fallback and auto-creates tenant log dir for RTS-07', async () => {
    const report = await getReadyToShipReport({ tenant: TENANT })
    const health = report.checks.find(check => check.check_id === 'RTS-01')
    const logs = report.checks.find(check => check.check_id === 'RTS-07')

    expect(report.ready_to_ship).toBe(true)
    expect(report.summary.pass).toBe(10)
    expect(health).toMatchObject({
      status: 'pass',
      summary: 'Runtime health mock-success',
    })
    expect(health?.detail).toContain("mode='mock-fallback'")
    expect(logs).toMatchObject({
      status: 'pass',
      summary: 'No boundary violations found',
    })
    await expect(access(path.join(tempRoot, `phase0/tenants/${TENANT}/logs`))).resolves.toBeUndefined()
  })

  it('uses real health endpoint when configured', async () => {
    process.env.MC_RTS_HEALTH_URL = 'http://127.0.0.1:9999/healthz'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })))

    const result = await evaluateRuntime(rule('RTS-01', 'OpenClaw 运行健康'))

    expect(result.status).toBe('pass')
    expect(result.summary).toBe('Health endpoint returned 200')
    expect(await readFile(path.join(tempRoot, 'phase0/templates/delivery-checklist/ready-to-ship-rules.json'), 'utf8')).toContain('RTS-01')
  })

  it('fails real health endpoint when body status is not ok', async () => {
    process.env.MC_RTS_HEALTH_URL = 'http://127.0.0.1:9999/healthz'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'degraded' }), { status: 200 })))

    const result = await evaluateRuntime(rule('RTS-01', 'OpenClaw 运行健康'))

    expect(result.status).toBe('fail')
    expect(result.summary).toBe('Health returned status=degraded')
  })
})
