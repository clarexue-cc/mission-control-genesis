import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  AreaChart: ({ children }: any) => <div>{children}</div>,
  Area: () => <div />,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
}))

import { SystemMonitorPanel } from '@/components/panels/system-monitor-panel'

const systemPayload = {
  timestamp: Date.now(),
  cpu: { usagePercent: 12, cores: 8, model: 'test cpu', loadAvg: [1, 2, 3] },
  memory: { totalBytes: 16 * 1024 ** 3, usedBytes: 4 * 1024 ** 3, availableBytes: 12 * 1024 ** 3, usagePercent: 25, swapTotalBytes: 0, swapUsedBytes: 0 },
  disk: [],
  gpu: null,
  network: [],
  processes: [],
}

const harnessPayload = {
  status: 'ready',
  tenant: 'ceo-assistant-v1',
  template: 'ceo-assistant-v1',
  total_cases: 46,
  harness_root: '/tmp/genesis-harness',
  runner_path: '/tmp/genesis-harness/tools/tg-test-runner.ts',
  suites: [
    { id: 'golden', label: 'Golden', expected: 10, actual: 10, status: 'pass' },
    { id: 'adversarial', label: 'Adversarial', expected: 25, actual: 25, status: 'pass' },
  ],
  checks: [
    { id: 'runner_parse', label: 'Runner list-cases', status: 'pass', detail: 'Parsed 46 cases' },
  ],
}

describe('SystemMonitorPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/harness/health')) {
        return Promise.resolve({ ok: true, json: async () => harnessPayload })
      }
      return Promise.resolve({ ok: true, json: async () => systemPayload })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows Harness Health in the monitor page', async () => {
    render(<SystemMonitorPanel />)

    await waitFor(() => {
      expect(screen.getByText('Harness Health')).toBeInTheDocument()
    })
    expect(screen.getByText('ready')).toBeInTheDocument()
    expect(screen.getByText(/ceo-assistant-v1 → ceo-assistant-v1/)).toBeInTheDocument()
    expect(screen.getAllByText(/46 cases/).length).toBeGreaterThan(0)
    expect(screen.getByText('Runner list-cases')).toBeInTheDocument()
  })
})
