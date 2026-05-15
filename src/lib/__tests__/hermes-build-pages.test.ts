import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('Hermes H-series build implementation', () => {
  it('provides shared tenant file helpers for Hermes APIs', () => {
    const helperPath = 'src/lib/hermes-api-helpers.ts'

    expect(existsSync(path.join(repoRoot, helperPath))).toBe(true)
    const source = read(helperPath)

    expect(source).toContain("resolveHarnessRoot")
    expect(source).toContain("readTenantFile")
    expect(source).toContain("listTenantDir")
    expect(source).toContain("phase0/tenants")
  })

  it('adds admin-protected Hermes file APIs for H1, H3, H5 and H6', () => {
    const routes = [
      ['src/app/api/onboarding/hermes/blueprint/route.ts', ['vault/intake-analysis.md', 'profile/profile-vars.json', 'profile/USER.md']],
      ['src/app/api/onboarding/hermes/deploy/route.ts', ['profile/identity/config.yaml', 'config/harness-meta.json', 'config/hermes.json', 'vault/Agent-情报搜集', 'vault/Agent-Shared']],
      ['src/app/api/onboarding/hermes/skills/route.ts', ['competitor-scan', 'trending-filter', 'user-demand-collect', 'low-fan-discovery', 'industry-scan', 'profile/cron-schedule.yaml', 'profile/approved-skills.json']],
      ['src/app/api/onboarding/hermes/governance-config/route.ts', ['config/boundary-rules.json', 'profile/cron-schedule.yaml', 'profile/approved-skills.json']],
    ] as const

    for (const [relativePath, markers] of routes) {
      expect(existsSync(path.join(repoRoot, relativePath))).toBe(true)
      const source = read(relativePath)
      expect(source).toContain("requireRole(request, 'admin')")
      expect(source).toContain("media-intel-agent")
      for (const marker of markers) {
        expect(source).toContain(marker)
      }
    }
  })

  it('renders real H1, H2, H3, H5 and H6 client pages from Hermes APIs', () => {
    const clients = [
      ['src/app/onboarding/hermes/blueprint/blueprint-client.tsx', '/api/onboarding/hermes/blueprint', ['intake-analysis.md', 'profile-vars.json', 'USER.md']],
      ['src/app/onboarding/hermes/approval/approval-client.tsx', '/api/onboarding/hermes/blueprint', ['Clare', '审批通过', 'intake-analysis.md']],
      ['src/app/onboarding/hermes/deploy/deploy-client.tsx', '/api/onboarding/hermes/deploy', ['config.yaml', 'harness-meta.json', 'hermes.json', 'Agent-情报搜集', 'Agent-Shared']],
      ['src/app/onboarding/hermes/skills/skills-client.tsx', '/api/onboarding/hermes/skills', ['competitor-scan', 'trending-filter', 'user-demand-collect', 'low-fan-discovery', 'industry-scan']],
      ['src/app/onboarding/hermes/governance-config/governance-config-client.tsx', '/api/onboarding/hermes/governance-config', ['boundary-rules.json', 'cron-schedule.yaml', 'approved-skills.json']],
    ] as const

    for (const [relativePath, endpoint, markers] of clients) {
      expect(existsSync(path.join(repoRoot, relativePath))).toBe(true)
      const source = read(relativePath)
      expect(source).toContain("'use client'")
      expect(source).toContain(endpoint)
      expect(source).toContain("useMissionControl")
      for (const marker of markers) {
        expect(source).toContain(marker)
      }
    }
  })

  it('guards every H-series page before rendering', () => {
    const pagePaths = [
      'src/app/onboarding/hermes/blueprint/page.tsx',
      'src/app/onboarding/hermes/approval/page.tsx',
      'src/app/onboarding/hermes/deploy/page.tsx',
      'src/app/onboarding/hermes/skills/page.tsx',
      'src/app/onboarding/hermes/governance-config/page.tsx',
      'src/app/onboarding/hermes/governance-verify/page.tsx',
      'src/app/onboarding/hermes/gate-tests/page.tsx',
      'src/app/onboarding/hermes/rts/page.tsx',
      'src/app/onboarding/hermes/delivery/page.tsx',
    ]

    for (const relativePath of pagePaths) {
      const source = read(relativePath)
      expect(source).toContain('requireHermesAdmin')
      expect(source).not.toContain('HermesPlaceholderPage')
    }
  })

  it('documents governance verification, gate tests, RTS and delivery matrices', () => {
    const h7 = read('src/app/onboarding/hermes/governance-verify/page.tsx')
    for (const marker of ['H-01 Profile Setup', 'H-02 Boundary Watchdog', 'H-03 Skill Curator', 'H-04 Memory Curator', 'H-05 Output Checker', 'H-06 Guardian', 'H-07 Cron Governance']) {
      expect(h7).toContain(marker)
    }
    expect(h7).toContain('/onboarding/hermes/skill-curator')

    const h8 = read('src/app/onboarding/hermes/gate-tests/page.tsx')
    for (const marker of ['G-01', 'G-07', 'A-01', 'A-04', 'HT-01', 'HT-08', 'ML-01', 'ML-05', 'LF-01', 'LF-05', 'HK-01', 'HK-06']) {
      expect(h8).toContain(marker)
    }

    const h10 = read('src/app/onboarding/hermes/rts/page.tsx')
    expect(h10).toContain('RTS-01')
    expect(h10).toContain('RTS-11')

    const h11 = read('src/app/onboarding/hermes/delivery/page.tsx')
    expect(h11).toContain('Vinson')
    expect(h11).toContain('爆款库')
    expect(h11).toContain('热点池')
    expect(h11).toContain('用户需求库')
  })

  it('adapts H4 identity labels for Hermes instead of OC AGENTS/boundary labels', () => {
    const source = read('src/app/onboarding/customer/soul/soul-client.tsx')

    expect(source).toContain('H4 核心身份')
    expect(source).toContain('Hermes Core Identity')
    expect(source).toContain('USER.md — 用户画像')
    expect(source).toContain('config.yaml — Hermes 主配置')
  })
})
