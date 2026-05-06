import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BriefingBarWidget } from '@/components/dashboard/widgets/briefing-bar-widget'
import type { DashboardData } from '@/components/dashboard/widget-primitives'
import { AlertRulesPanel } from '@/components/panels/alert-rules-panel'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }
}

function dashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    isLocal: false,
    systemStats: {},
    dbStats: {
      tasks: { total: 0, byStatus: {} },
      agents: { total: 1, byStatus: {} },
      audit: { day: 0, week: 0, loginFailures: 0 },
      activities: { day: 0 },
      notifications: { unread: 0 },
      pipelines: { active: 0, recentDay: 0 },
      backup: null,
      dbSizeBytes: 0,
      webhookCount: 0,
    },
    claudeStats: null,
    githubStats: null,
    loading: { system: false, sessions: false, claude: false, github: false },
    sessions: [],
    logs: [],
    agents: [{ id: 1, status: 'idle' }],
    tasks: [],
    connection: { isConnected: true, url: 'ws://localhost', reconnectAttempts: 0, latency: 42 },
    subscription: null,
    llmTodaySummary: { requestCount: 0, avgDurationSeconds: 0 },
    navigateToPanel: vi.fn(),
    openSession: vi.fn(),
    memPct: 20,
    diskPct: 10,
    systemLoad: 20,
    activeSessions: 0,
    errorCount: 0,
    onlineAgents: 1,
    claudeActive: 0,
    codexActive: 0,
    hermesActive: 0,
    claudeLocalSessions: [],
    codexLocalSessions: [],
    hermesLocalSessions: [],
    runningTasks: 0,
    inboxCount: 0,
    assignedCount: 0,
    reviewCount: 0,
    doneCount: 0,
    backlogCount: 0,
    mergedRecentLogs: [],
    recentErrorLogs: 0,
    localOsStatus: { value: 'Healthy', status: 'good' },
    claudeHealth: { value: 'Idle', status: 'warn' },
    codexHealth: { value: 'Idle', status: 'warn' },
    hermesHealth: { value: 'Idle', status: 'warn' },
    mcHealth: { value: 'Healthy', status: 'good' },
    gatewayHealthStatus: 'good',
    isSystemLoading: false,
    isSessionsLoading: false,
    isClaudeLoading: false,
    isGithubLoading: false,
    hermesCronJobCount: 0,
    subscriptionLabel: null,
    subscriptionPrice: null,
    ...overrides,
  } as DashboardData
}

describe('Langfuse deep links', () => {
  const originalLangfuseUrl = process.env.NEXT_PUBLIC_LANGFUSE_URL

  beforeEach(() => {
    process.env.NEXT_PUBLIC_LANGFUSE_URL = 'https://langfuse.example'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.NEXT_PUBLIC_LANGFUSE_URL = originalLangfuseUrl
  })

  it('shows a Langfuse trace link only for alerts with langfuse_trace_id', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/alerts') {
        return Promise.resolve(jsonResponse({
          rules: [],
          alerts: [
            {
              id: 'alert-with-trace',
              timestamp: Date.parse('2026-05-06T09:00:00Z'),
              severity: 'warning',
              title: 'LLM latency spike',
              message: 'Call took longer than expected',
              source: 'system',
              source_label: 'System alerts',
              source_type: 'llm',
              acknowledged: false,
              jump_href: '/logs',
              langfuse_trace_id: 'trace-abc-123',
            },
            {
              id: 'alert-without-trace',
              timestamp: Date.parse('2026-05-06T09:01:00Z'),
              severity: 'info',
              title: 'Regular alert',
              message: 'No trace attached',
              source: 'system',
              source_label: 'System alerts',
              source_type: 'system',
              acknowledged: false,
              jump_href: '/logs',
            },
          ],
        }))
      }
      return Promise.resolve(jsonResponse({}))
    }))

    render(<AlertRulesPanel />)

    expect(await screen.findByText('LLM latency spike')).toBeInTheDocument()
    expect(screen.getByText('Regular alert')).toBeInTheDocument()
    const traceLinks = screen.getAllByRole('link', { name: '查看调用链路' })
    expect(traceLinks).toHaveLength(1)
    expect(traceLinks[0]).toHaveAttribute('href', 'https://langfuse.example/trace/trace-abc-123')
  })

  it('shows today LLM call summary with a Langfuse traces list link in overview briefing', () => {
    render(<BriefingBarWidget data={dashboardData({
      llmTodaySummary: {
        requestCount: 12,
        avgDurationSeconds: 1.5,
      },
    } as Partial<DashboardData>)} />)

    expect(screen.getByText(/今日 LLM 调用 12 次/)).toBeInTheDocument()
    expect(screen.getByText(/平均耗时 1.5s/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看全部 →' })).toHaveAttribute('href', 'https://langfuse.example/traces')
  })
})
