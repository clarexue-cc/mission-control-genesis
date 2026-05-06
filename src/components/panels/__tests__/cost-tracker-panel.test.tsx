import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CostTrackerPanel } from '@/components/panels/cost-tracker-panel'
import { useMissionControl } from '@/store'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      title: 'Cost Tracker',
      subtitle: 'Usage and spend visibility',
      loadingCostData: 'Loading cost data',
      noUsageData: 'No usage data',
      noUsageDataDesc: 'No usage data yet',
      refresh: 'Refresh',
    }
    return labels[key] || key
  },
}))

vi.mock('@/components/panels/tenant-billing-comparison', () => ({
  TenantBillingComparison: () => <div data-testid="tenant-billing-comparison" />,
}))

vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const Leaf = () => <div />

  return {
    ResponsiveContainer: Container,
    PieChart: Container,
    Pie: Container,
    Cell: Leaf,
    LineChart: Container,
    Line: Leaf,
    XAxis: Leaf,
    YAxis: Leaf,
    CartesianGrid: Leaf,
    Tooltip: Leaf,
    Legend: Leaf,
    BarChart: Container,
    Bar: Leaf,
  }
})

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)]),
  }
}

function setCustomerMode() {
  window.history.pushState({}, '', '/?role=customer&tenant=ceo-assistant-v1')
  document.cookie = 'mc-view-role=customer; path=/'
}

function buildDefaultFetchMock() {
  return vi.fn((url: string) => {
    if (url === '/api/tokens?action=stats&timeframe=day') {
      return Promise.resolve(jsonResponse({
        summary: {
          totalTokens: 1200,
          totalCost: 1.25,
          requestCount: 12,
          avgTokensPerRequest: 100,
          avgCostPerRequest: 0.1042,
        },
        models: {},
        sessions: {},
        timeframe: 'day',
        recordCount: 0,
      }))
    }

    if (url === '/api/tokens?action=trends&timeframe=day') {
      return Promise.resolve(jsonResponse({ trends: [], timeframe: 'day' }))
    }

    if (url === '/api/tokens/by-agent?days=1') {
      return Promise.resolve(jsonResponse({
        agents: [],
        summary: {
          total_cost: 0,
          total_tokens: 0,
          agent_count: 0,
          days: 1,
        },
      }))
    }

    if (url === '/api/tokens?action=task-costs&timeframe=day') {
      return Promise.resolve(jsonResponse({
        summary: {
          totalTokens: 0,
          totalCost: 0,
          requestCount: 0,
          avgTokensPerRequest: 0,
          avgCostPerRequest: 0,
        },
        tasks: [],
        agents: {},
        unattributed: {
          totalTokens: 0,
          totalCost: 0,
          requestCount: 0,
          avgTokensPerRequest: 0,
          avgCostPerRequest: 0,
        },
        timeframe: 'day',
      }))
    }

    if (url === '/api/langfuse/traces?tenantId=ceo-assistant-v1') {
      return Promise.resolve(jsonResponse({
        traces: [
          {
            id: 'trace-1',
            timestamp: '2026-05-06T08:30:00.000Z',
            agent: 'customer-support',
            skill: 'refund-check',
            model: 'openai/gpt-4.1-mini',
            latencyMs: 892,
            totalTokens: 640,
            costUsd: 0.0123,
            status: 'success',
          },
        ],
      }))
    }

    if (url === '/api/langfuse/trace/trace-1') {
      return Promise.resolve(jsonResponse({
        id: 'trace-1',
        publicUrl: 'https://langfuse.example/trace-1',
        input: 'user asks for a refund status',
        output: 'tool call summary',
        metadata: {
          source: 'mock',
          tenantId: 'ceo-assistant-v1',
        },
        observations: [
          {
            id: 'obs-1',
            name: 'retrieve-order',
            type: 'tool',
            model: 'openai/gpt-4.1-mini',
            latencyMs: 220,
            status: 'success',
          },
        ],
      }))
    }

    return Promise.resolve(jsonResponse({}))
  })
}

describe('CostTrackerPanel', () => {
  beforeEach(() => {
    setCustomerMode()
    useMissionControl.setState({
      agents: [],
      sessions: [],
      currentUser: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.cookie = 'mc-view-role=; path=/; max-age=0'
    window.history.pushState({}, '', '/')
  })

  it('shows traces tab for customers and hides budget controls', async () => {
    const fetchMock = buildDefaultFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    render(<CostTrackerPanel />)

    expect(await screen.findByRole('button', { name: 'Traces' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '预算' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Traces' }))

    expect(await screen.findByText('customer-support')).toBeInTheDocument()
    expect(screen.getByText('refund-check')).toBeInTheDocument()
    expect(screen.getByText('892ms')).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/langfuse/traces?tenantId=ceo-assistant-v1', expect.objectContaining({
        cache: 'no-store',
      }))
    })
  })

  it('loads trace details and renders Langfuse deep link', async () => {
    const fetchMock = buildDefaultFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    render(<CostTrackerPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Traces' }))
    fireEvent.click(await screen.findByRole('button', { name: /customer-support/i }))

    expect(await screen.findByText('tool call summary')).toBeInTheDocument()
    expect(screen.getByText('retrieve-order')).toBeInTheDocument()

    const deepLink = screen.getByRole('link', { name: 'Open in Langfuse' })
    expect(deepLink).toHaveAttribute('href', 'https://langfuse.example/trace-1')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/langfuse/trace/trace-1', expect.objectContaining({
        cache: 'no-store',
      }))
    })
  })
})