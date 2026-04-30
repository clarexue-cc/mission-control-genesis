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

describe('HarnessPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => harnessPayload,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows harness operations separately from the P10 test console', async () => {
    render(<HarnessPanel />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Harness Operations', level: 1 })).toBeInTheDocument()
    })
    expect(screen.getByText('Harness owns runner readiness, test inventory, reports, and runtime target checks.')).toBeInTheDocument()
    expect(screen.getByText('docker exec ceo-assistant-v1')).toBeInTheDocument()
    expect(screen.getAllByText('Runtime container').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No such container: ceo-assistant-v1').length).toBeGreaterThan(0)
    expect(screen.getByText('Runner list-cases')).toBeInTheDocument()
    expect(screen.getByText('46')).toBeInTheDocument()
    expect(screen.getByText('Drift')).toBeInTheDocument()
    expect(screen.getByText('/Users/clare/Desktop/genesis-harness/phase0/tests/results/latest.md')).toBeInTheDocument()
  })
})
