import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mc-stable-mode', () => ({
  resolveDefaultCustomerTenantId: () => 'ceo-assistant-v1',
}))

import { TestConsolePanel } from '@/components/panels/test-console'

describe('TestConsolePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tenant: 'ceo-assistant-v1',
        template: 'ceo-assistant-v1',
        total: 46,
        harness_root: '/Users/clare/Desktop/genesis-harness',
        runner_path: '/Users/clare/Desktop/genesis-harness/tools/tg-test-runner.ts',
        suites: [
          {
            id: 'golden',
            label: 'Golden',
            expected: 10,
            case_count: 10,
            checkpoint: 'P7 SOUL/AGENTS + P9 Skills',
            objective: '验证 CEO Assistant 的允许业务能力和 skill routing。',
            sources: [
              { label: '测试题', path: 'phase0/templates/ceo-assistant-v1/tests/golden-10-cc.md', exists: true },
              { label: '技能要求', path: 'phase0/templates/ceo-assistant-v1/skills/news-aggregation/SKILL.md', exists: true },
            ],
            criteria: ['回答必须匹配对应 skill 的输出要求。'],
            failure_modes: ['skill 路由错。'],
            optimization_targets: ['优化 P9 skills / AGENTS routing。'],
            cases: [
              { testId: 'GOLDEN-CEO-01', title: '日常资讯聚合', prompt: '帮我看看今天 Web3 有什么重要新闻' },
            ],
          },
        ],
      }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('labels the page as the P10 test console', async () => {
    render(<TestConsolePanel />)

    expect(screen.getByRole('heading', { name: 'P10 Test Console', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('测试维度与出处')).toBeInTheDocument()
  })

  it('exposes all P10 test suites', async () => {
    render(<TestConsolePanel />)

    expect(screen.getByRole('button', { name: /Golden\s+10/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Adversarial\s+25/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cross-session\s+3/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Drift\s+8/ })).toBeInTheDocument()
    expect(await screen.findByText('测试维度与出处')).toBeInTheDocument()
  })

  it('shows the test dimensions with source provenance before a run starts', async () => {
    render(<TestConsolePanel />)

    await waitFor(() => {
      expect(screen.getByText('测试维度与出处')).toBeInTheDocument()
    })
    expect(screen.getByText('P7 SOUL/AGENTS + P9 Skills')).toBeInTheDocument()
    expect(screen.getByText('phase0/templates/ceo-assistant-v1/tests/golden-10-cc.md')).toBeInTheDocument()
    expect(screen.getByText('回答必须匹配对应 skill 的输出要求。')).toBeInTheDocument()
    expect(screen.getByText('优化 P9 skills / AGENTS routing。')).toBeInTheDocument()
  })

  it('shows harness source and runtime target inside P10 instead of relying on Monitor', async () => {
    render(<TestConsolePanel />)

    expect(await screen.findByText('Harness Source of Truth')).toBeInTheDocument()
    expect(screen.getByText('Harness root')).toBeInTheDocument()
    expect(screen.getByText('/Users/clare/Desktop/genesis-harness')).toBeInTheDocument()
    expect(screen.getByText('Harness runner')).toBeInTheDocument()
    expect(screen.getByText('/Users/clare/Desktop/genesis-harness/tools/tg-test-runner.ts')).toBeInTheDocument()
    expect(screen.getByText('Runtime target')).toBeInTheDocument()
    expect(screen.getByText('docker exec ceo-assistant-v1')).toBeInTheDocument()
  })
})
