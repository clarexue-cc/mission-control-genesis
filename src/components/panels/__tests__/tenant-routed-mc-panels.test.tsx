import { act, render, screen, waitFor } from '@testing-library/react'
import { createElement, type AnchorHTMLAttributes } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CustomerOnboardingPage from '@/app/onboarding/customer/page'
import { HermesCronPanel } from '@/components/panels/hermes-cron-panel'
import { HermesGuardianPanel } from '@/components/panels/hermes-guardian-panel'
import { HermesMemoryPanel } from '@/components/panels/hermes-memory-panel'
import { HermesOutputPanel } from '@/components/panels/hermes-output-panel'
import { useMissionControl, type Tenant } from '@/store'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    createElement('a', { href, ...props }, children)
  ),
}))

function tenant(slug: string): Tenant {
  return {
    id: slug === 'media-intel-agent' ? 2 : 1,
    slug,
    display_name: slug,
    status: 'active',
    linux_user: slug,
    base: slug === 'media-intel-agent' ? 'hermes' : 'oc',
  }
}

function okResponse(body: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  }
}

describe('tenant-routed MC panels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ scriptExists: true })))
    localStorage.clear()
    useMissionControl.setState({ activeTenant: tenant('media-intel-agent') })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('prefills P3 customer onboarding with the active tenant slug', async () => {
    render(<CustomerOnboardingPage />)

    await waitFor(() => {
      expect(screen.getByLabelText('Tenant ID')).toHaveValue('media-intel-agent')
    })

    act(() => {
      useMissionControl.setState({ activeTenant: tenant('wechat-mp-agent') })
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Tenant ID')).toHaveValue('wechat-mp-agent')
    })
  })

  it('routes Hermes H-04 to H-07 default paths through the active tenant', async () => {
    const cases = [
      {
        renderPanel: () => render(<HermesMemoryPanel />),
        fields: [
          ['Memories dir', 'phase0/tenants/media-intel-agent/memory/memories'],
          ['Memory config', 'phase0/tenants/media-intel-agent/memory/memory-config.json'],
          ['Tenant id', 'media-intel-agent'],
        ],
      },
      {
        renderPanel: () => render(<HermesOutputPanel />),
        fields: [
          ['Sessions dir', 'phase0/tenants/media-intel-agent/sessions'],
          ['Checker config', 'phase0/tenants/media-intel-agent/output-checker-config.json'],
        ],
      },
      {
        renderPanel: () => render(<HermesGuardianPanel />),
        fields: [
          ['Profile dir', 'phase0/tenants/media-intel-agent'],
          ['Halt signal', 'phase0/tenants/media-intel-agent/halt-signal.json'],
          ['Budget file', 'phase0/tenants/media-intel-agent/budget.json'],
          ['Usage log', 'phase0/tenants/media-intel-agent/logs/token-usage.jsonl'],
        ],
      },
      {
        renderPanel: () => render(<HermesCronPanel />),
        fields: [
          ['Cron dir', 'phase0/tenants/media-intel-agent/cron'],
          ['Budget file', 'phase0/tenants/media-intel-agent/budget.json'],
        ],
      },
    ] as const

    for (const item of cases) {
      const rendered = item.renderPanel()
      for (const [label, value] of item.fields) {
        expect(screen.getByLabelText(label)).toHaveValue(value)
      }
      rendered.unmount()
    }
  })

  it('updates generic Hermes operation defaults when the active tenant changes', async () => {
    useMissionControl.setState({ activeTenant: tenant('tenant-test-001') })
    render(<HermesGuardianPanel />)

    expect(screen.getByLabelText('Profile dir')).toHaveValue('phase0/tenants/tenant-test-001')

    act(() => {
      useMissionControl.setState({ activeTenant: tenant('media-intel-agent') })
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Profile dir')).toHaveValue('phase0/tenants/media-intel-agent')
    })
  })
})
