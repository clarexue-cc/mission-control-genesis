import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentSquadPanelPhase3 } from '@/components/panels/agent-squad-panel-phase3'
import { CustomerViewOverrides } from '@/components/panels/customer-view-overrides'
import { SkillsPanel } from '@/components/panels/skills-panel'
import { useMissionControl, type Agent } from '@/store'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const labels: Record<string, string> = {
      activeHeartbeats: `Active ${values?.count ?? 0}`,
      addAgent: 'Add Agent',
      live: 'Live',
      manual: 'Manual',
      noAgents: 'No agents',
      noAgentsHint: 'No agents yet',
      refresh: 'Refresh',
      save: 'Save',
      syncConfig: 'Sync Config',
      syncLocal: 'Sync Local',
      syncing: 'Syncing',
      title: 'Agents',
      wake: 'Wake',
      spawn: 'Spawn',
    }
    return labels[key] || key
  },
}))

const agent: Agent = {
  id: 101,
  name: 'Customer Concierge',
  role: 'Customer support',
  status: 'idle',
  last_seen: Math.floor(Date.now() / 1000) - 60,
  last_activity: 'Prepared today summary',
  created_at: 1700000000,
  updated_at: 1700000600,
  config: {
    preferences: {
      tone: 'warm',
      language: 'zh-CN',
      response_length: 'balanced',
    },
  },
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 403,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)]),
  }
}

function setRole(role: string) {
  window.history.pushState({}, '', `/?role=${encodeURIComponent(role)}&tenant=tenant-owned-007`)
  document.cookie = `mc-view-role=${encodeURIComponent(role)}; path=/`
}

describe('customer panel role trimming', () => {
  beforeEach(() => {
    useMissionControl.setState({
      activeTenant: { id: 7, slug: 'tenant-owned-007', display_name: 'Tenant Owned', status: 'active', linux_user: 'tenant-owned' },
      agents: [],
      sessions: [],
      currentUser: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.cookie = 'mc-view-role=; path=/; max-age=0'
    window.history.pushState({}, '', '/')
    useMissionControl.setState({ agents: [], sessions: [], currentUser: null })
  })

  it('hides cost data from the customer-user overview', () => {
    setRole('customer-user')

    render(<CustomerViewOverrides panel="overview" />)

    expect(screen.getByText('Agent 状态')).toBeInTheDocument()
    expect(screen.getByText('今日完成')).toBeInTheDocument()
    expect(screen.queryByText(/cost|billing|budget|费用|账单|预算|\$/i)).not.toBeInTheDocument()
  })

  it('keeps customer-user agents read-only and hides preference editing', async () => {
    setRole('customer-user')
    useMissionControl.setState({ agents: [agent] })
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/agents') return Promise.resolve(jsonResponse({ agents: [agent] }))
      if (url === '/api/langfuse/agent-stats?tenantId=tenant-owned-007') return Promise.resolve(jsonResponse({ agents: [] }))
      return Promise.resolve(jsonResponse({}))
    }))

    render(<AgentSquadPanelPhase3 />)

    expect(await screen.findByText('Customer Concierge')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Prepared today summary')).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Customer preferences' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add Agent' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Sync Config' })).not.toBeInTheDocument()
    })
  })

  it('hides skill toggles from customer-user', async () => {
    setRole('customer-user')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({
      ok: true,
      total: 1,
      skills: [{
        tenant_id: 'tenant-owned-007',
        skill_name: 'daily-brief',
        title: 'Daily Brief',
        vault_path: 'vault/skills/daily-brief.md',
        path: 'phase0/tenants/tenant-owned-007/vault/skills/daily-brief.md',
        excerpt: 'Summarizes customer updates.',
      }],
    }))))

    render(<SkillsPanel />)

    expect(await screen.findByText('Daily Brief')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('switch', { name: /Daily Brief/i })).not.toBeInTheDocument()
    })
  })

  it('shows preference editing and skill toggles to customer-admin', async () => {
    setRole('customer-admin')
    useMissionControl.setState({ agents: [agent] })
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/agents') return Promise.resolve(jsonResponse({ agents: [agent] }))
      if (url === '/api/langfuse/agent-stats?tenantId=tenant-owned-007') return Promise.resolve(jsonResponse({ agents: [] }))
      if (url === `/api/harness/agents/${encodeURIComponent(agent.name)}/preferences`) {
        return Promise.resolve(jsonResponse({ tone: 'warm', language: 'zh-CN', response_length: 'balanced' }))
      }
      if (url === '/api/onboarding/customer/skills/inventory') {
        return Promise.resolve(jsonResponse({
          ok: true,
          total: 1,
          skills: [{
            tenant_id: 'tenant-owned-007',
            skill_name: 'daily-brief',
            title: 'Daily Brief',
            vault_path: 'vault/skills/daily-brief.md',
            path: 'phase0/tenants/tenant-owned-007/vault/skills/daily-brief.md',
            excerpt: 'Summarizes customer updates.',
          }],
        }))
      }
      return Promise.resolve(jsonResponse({}))
    }))

    render(<AgentSquadPanelPhase3 />)

    expect(await screen.findByRole('group', { name: 'Customer preferences' })).toBeInTheDocument()

    render(<SkillsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /Daily Brief/i })).toBeInTheDocument()
    })
  })
})
