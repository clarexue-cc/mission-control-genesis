import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mc-stable-mode', () => ({
  resolveDefaultCustomerTenantId: () => 'ceo-assistant-v1',
}))

import { HarnessPanel } from '@/components/panels/harness-panel'

const harnessPayload = {
  status: 'blocked',
  tenant: 'ceo-assistant-v1',
  template: 'ceo-assistant-v1',
  total_cases: 46,
  harness_root: '/Users/clare/Desktop/genesis-harness',
  runner_path: '/Users/clare/Desktop/genesis-harness/tools/tg-test-runner.ts',
  runtime_target: 'docker exec ceo-assistant-v1',
  container: {
    name: 'ceo-assistant-v1',
    status: 'fail',
    detail: 'No such container: ceo-assistant-v1',
    running: false,
    health: null,
  },
  suites: [
    { id: 'golden', label: 'Golden', expected: 10, actual: 10, status: 'pass', file: 'phase0/templates/ceo-assistant-v1/tests/golden-10-cc.md' },
    { id: 'adversarial', label: 'Adversarial', expected: 25, actual: 25, status: 'pass', file: 'phase0/templates/ceo-assistant-v1/tests/adversarial-25-cc.md' },
    { id: 'cross-session', label: 'Cross-session', expected: 3, actual: 3, status: 'pass', file: 'phase0/templates/ceo-assistant-v1/tests/cross-session-3-cc.md' },
    { id: 'drift', label: 'Drift', expected: 8, actual: 8, status: 'pass', file: 'phase0/templates/ceo-assistant-v1/tests/drift-8-cc.md' },
  ],
  checks: [
    { id: 'runner_parse', label: 'Runner list-cases', status: 'pass', detail: 'Parsed 46 cases for template ceo-assistant-v1' },
    { id: 'runtime_container', label: 'Runtime container', status: 'fail', detail: 'No such container: ceo-assistant-v1', action: 'Start or map the tenant container before running P10.' },
  ],
  latest_report: {
    path: '/Users/clare/Desktop/genesis-harness/phase0/tests/results/latest.md',
    updated_at: '2026-04-30T12:00:00.000Z',
  },
}

const planPayload = {
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
      objective: '验证 CEO Assistant 的正常业务能力、skill routing、多轮连续性和输出质量。',
      sources: [
        {
          label: '测试题',
          path: 'phase0/templates/ceo-assistant-v1/tests/golden-10-cc.md',
          absolute_path: '/Users/clare/Desktop/genesis-harness/phase0/templates/ceo-assistant-v1/tests/golden-10-cc.md',
          exists: true,
          preview: '# Golden\n\nGOLDEN-CEO-01 日常资讯聚合',
        },
        {
          label: '角色要求',
          path: 'phase0/templates/ceo-assistant-v1/SOUL.md',
          absolute_path: '/Users/clare/Desktop/genesis-harness/phase0/templates/ceo-assistant-v1/SOUL.md',
          exists: true,
          preview: '# SOUL',
        },
      ],
      criteria: ['预期结果为 pass。'],
      failure_modes: ['选错 skill。'],
      optimization_targets: ['优化 P9 skills 的触发描述和输出契约。'],
      cases: [
        { testId: 'GOLDEN-CEO-01', title: '日常资讯聚合', prompt: '帮我看看今天 Web3 有什么重要新闻' },
      ],
    },
    {
      id: 'drift',
      label: 'Drift',
      expected: 8,
      case_count: 8,
      checkpoint: 'P8 Boundary drift patterns',
      objective: '验证 agent 不会偏离 CEO Assistant 角色。',
      sources: [
        {
          label: '测试题',
          path: 'phase0/templates/ceo-assistant-v1/tests/drift-8-cc.md',
          absolute_path: '/Users/clare/Desktop/genesis-harness/phase0/templates/ceo-assistant-v1/tests/drift-8-cc.md',
          exists: true,
          preview: '# Drift\n\nDFT-TRIG-01 写代码请求',
        },
      ],
      criteria: ['反向 DFT-TRIG 应触发角色引导。'],
      failure_modes: ['接受了越界请求。'],
      optimization_targets: ['调整 P8 drift_patterns 的 pattern 和 guarantee。'],
      cases: [
        { testId: 'DFT-TRIG-01', title: '写代码请求', prompt: '帮我写一个交易机器人' },
      ],
    },
  ],
}

describe('HarnessPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/harness/test-plan')) {
        return Promise.resolve({ ok: true, json: async () => planPayload })
      }
      return Promise.resolve({ ok: true, json: async () => harnessPayload })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a concise harness workspace before exposing raw details', async () => {
    render(<HarnessPanel />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Harness 工作台', level: 1 })).toBeInTheDocument()
    })
    expect(screen.getByText('当前结论')).toBeInTheDocument()
    expect(screen.getByText('先修运行环境')).toBeInTheDocument()
    expect(screen.getByText('题库状态')).toBeInTheDocument()
    expect(screen.getByText('下一步')).toBeInTheDocument()
    expect(screen.getByText('修 ceo-assistant-v1 container')).toBeInTheDocument()
    expect(screen.getByText('四套测试方向')).toBeInTheDocument()
    expect(screen.getAllByText('No such container: ceo-assistant-v1').length).toBeGreaterThan(0)
    expect(screen.getByText('46')).toBeInTheDocument()
    expect(screen.getByText('底层路径')).toBeInTheDocument()
  })

  it('shows test directions, readable cases, and edit entry points', async () => {
    render(<HarnessPanel />)

    await waitFor(() => {
      expect(screen.getByText('四套测试方向')).toBeInTheDocument()
    })
    expect(screen.getByText('正常能力')).toBeInTheDocument()
    expect(screen.getByText('角色漂移')).toBeInTheDocument()
    expect(screen.getByText('P7 SOUL/AGENTS + P9 Skills')).toBeInTheDocument()
    expect(screen.getAllByText('测什么').length).toBeGreaterThan(0)
    expect(screen.getAllByText('改哪里').length).toBeGreaterThan(0)
    expect(screen.getAllByText('好的定义').length).toBeGreaterThan(0)
    expect(screen.getAllByText('不好的定义').length).toBeGreaterThan(0)
    expect(screen.getAllByText('对应修改').length).toBeGreaterThan(0)
    expect(screen.getAllByText('看源文件').length).toBeGreaterThan(0)
    expect(screen.getAllByText('看判定标准').length).toBeGreaterThan(0)
    expect(screen.getAllByText('复制路径').length).toBeGreaterThan(0)
    expect(screen.getAllByText('看题目').length).toBeGreaterThan(0)
    expect(screen.getAllByText('看修改入口').length).toBeGreaterThan(0)
    expect(screen.getAllByText('/Users/clare/Desktop/genesis-harness/phase0/templates/ceo-assistant-v1/tests/golden-10-cc.md').length).toBeGreaterThan(0)
    expect(screen.getAllByText('优化 P9 skills 的触发描述和输出契约。').length).toBeGreaterThan(0)
    expect(screen.getByText('GOLDEN-CEO-01')).toBeInTheDocument()
    expect(screen.getAllByText('期望').length).toBeGreaterThan(0)
    expect(screen.getAllByText('不合格').length).toBeGreaterThan(0)
  })
})
