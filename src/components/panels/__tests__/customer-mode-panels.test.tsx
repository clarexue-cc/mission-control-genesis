import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentSquadPanelPhase3 } from '@/components/panels/agent-squad-panel-phase3'
import { HarnessProviderManager, maskApiKey } from '@/components/panels/harness-provider-manager'
import { SettingsPanel } from '@/components/panels/settings-panel'
import { useMissionControl, type Agent } from '@/store'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const labels: Record<string, string> = {
      activeHeartbeats: `Active ${values?.count ?? 0}`,
      addAgent: 'Add Agent',
      description: 'Settings description',
      discard: 'Discard',
      live: 'Live',
      manual: 'Manual',
      noAgents: 'No agents',
      noAgentsHint: 'No agents yet',
      refresh: 'Refresh',
      save: 'Save',
      saveChanges: 'Save changes',
      saving: 'Saving',
      syncConfig: 'Sync Config',
      syncLocal: 'Sync Local',
      syncing: 'Syncing',
      title: 'Settings',
      wake: 'Wake',
      spawn: 'Spawn',
    }
    return labels[key] || key
  },
}))

vi.mock('@/lib/navigation', () => ({
  useNavigateToPanel: () => vi.fn(),
}))

const customerAgent: Agent = {
  id: 42,
  name: 'Chief-of-Staff',
  role: 'CEO assistant',
  status: 'idle',
  last_seen: Math.floor(Date.now() / 1000) - 120,
  last_activity: 'Prepared the morning briefing',
  created_at: 1700000000,
  updated_at: 1700000600,
  config: {},
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 403,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)]),
  }
}

function setCustomerMode() {
  window.history.pushState({}, '', '/?role=customer')
  document.cookie = 'mc-view-role=customer; path=/'
}

describe('customer-mode panels', () => {
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

  it('masks tenant provider keys and hides marked master keys for customers', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/harness/providers?tenantId=ceo-assistant-v1') {
        return Promise.resolve(jsonResponse({
          providers: [
            {
              name: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-live-customer-secret-1234567890',
            },
            {
              name: 'root-master',
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-system-master-secret',
              scope: 'system',
              isMaster: true,
            },
          ],
        }))
      }
      if (url === '/api/harness/providers/openai' && init?.method === 'DELETE') {
        return Promise.resolve(jsonResponse({ deleted: true }))
      }
      return Promise.resolve(jsonResponse({ ok: true, providers: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(maskApiKey('sk-live-customer-secret-1234567890')).toBe('sk-****7890')

    render(<HarnessProviderManager />)

    expect(await screen.findByText('openai')).toBeInTheDocument()
    expect(screen.getByText('sk-****7890')).toBeInTheDocument()
    expect(screen.queryByText('sk-live-customer-secret-1234567890')).not.toBeInTheDocument()
    expect(screen.queryByText('root-master')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save provider' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test openai' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete openai' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/harness/providers/openai', expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ tenantId: 'ceo-assistant-v1' }),
      }))
    })
  })

  it('shows customer settings and hides admin-only settings blocks', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/settings') {
        return Promise.resolve(jsonResponse({ error: 'Admin access required' }, false))
      }
      if (url === '/api/harness/budget/ceo-assistant-v1') {
        return Promise.resolve(jsonResponse({
          monthly_budget_usd: 50,
          alert_at_percent: 80,
          action_on_exceed: 'pause',
        }))
      }
      if (url === '/api/harness/billing/ceo-assistant-v1') {
        return Promise.resolve(jsonResponse({
          totals: { estimatedCostUsd: 12.5, totalTokens: 1400, calls: 9 },
        }))
      }
      if (url === '/api/harness/providers?tenantId=ceo-assistant-v1') {
        return Promise.resolve(jsonResponse({
          providers: [
            { name: 'openai', baseUrl: 'https://api.openai.com/v1', keyLast4: '7890' },
            { name: 'anthropic', baseUrl: 'https://api.anthropic.com', keyLast4: 'abcd' },
          ],
        }))
      }
      if (url === '/api/harness/tenant/ceo-assistant-v1/preferences' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({
          default_model: 'anthropic',
          notifications: {
            email: false,
            budgetAlerts: true,
            deliveryUpdates: false,
          },
        }))
      }
      if (url === '/api/harness/tenant/ceo-assistant-v1/preferences' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({
          default_model: 'openai',
          notifications: {
            email: true,
            budgetAlerts: true,
            deliveryUpdates: false,
          },
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SettingsPanel />)

    expect(await screen.findByRole('heading', { name: 'Tenant budget' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Model preference')).toHaveValue('anthropic')
    })
    expect(screen.getByLabelText('Budget alerts')).toBeChecked()
    expect(screen.getByLabelText('Email notifications')).not.toBeChecked()
    expect(screen.getByLabelText('Delivery updates')).not.toBeChecked()
    expect(screen.queryByText('Interface Mode')).not.toBeInTheDocument()
    expect(screen.queryByText('Hook Profile')).not.toBeInTheDocument()
    expect(screen.queryByText('Agent Runtimes')).not.toBeInTheDocument()
    expect(screen.queryByText('Admin access required')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Model preference'), { target: { value: 'openai' } })
    fireEvent.click(screen.getByLabelText('Email notifications'))
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/harness/tenant/ceo-assistant-v1/preferences', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          default_model: 'openai',
          notifications: {
            email: true,
            budgetAlerts: true,
            deliveryUpdates: false,
          },
        }),
      }))
    })
  })

  it('hides internal agent configuration while exposing editable customer preferences', async () => {
    useMissionControl.setState({ agents: [customerAgent] })
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/agents') {
        return Promise.resolve(jsonResponse({ agents: [customerAgent] }))
      }
      return Promise.resolve(jsonResponse({}))
    }))

    render(<AgentSquadPanelPhase3 />)

    const card = await screen.findByText('Chief-of-Staff')
    expect(card).toBeInTheDocument()
    expect(screen.getByText('CEO assistant')).toBeInTheDocument()
    expect(screen.getByText('Prepared the morning briefing')).toBeInTheDocument()

    const customerPreferences = screen.getByRole('group', { name: 'Customer preferences' })
    expect(within(customerPreferences).getByLabelText('Tone')).toBeInTheDocument()
    expect(within(customerPreferences).getByLabelText('Language')).toBeInTheDocument()
    expect(within(customerPreferences).getByLabelText('Response length')).toBeInTheDocument()

    fireEvent.click(card)

    await waitFor(() => {
      expect(screen.queryByText('SOUL')).not.toBeInTheDocument()
      expect(screen.queryByText('Config')).not.toBeInTheDocument()
      expect(screen.queryByText(/prompt/i)).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Add Agent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync Config' })).not.toBeInTheDocument()
  })
})
