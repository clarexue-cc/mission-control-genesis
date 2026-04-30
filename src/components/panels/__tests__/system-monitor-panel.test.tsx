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

describe('SystemMonitorPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      return Promise.resolve({ ok: true, json: async () => systemPayload })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps Monitor scoped to system telemetry instead of harness operations', async () => {
    render(<SystemMonitorPanel />)

    await waitFor(() => {
      expect(screen.getByText('System Monitor')).toBeInTheDocument()
    })
    expect(screen.queryByText('Harness Health')).not.toBeInTheDocument()
    expect(screen.queryByText('Runner list-cases')).not.toBeInTheDocument()
  })
})
