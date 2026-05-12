import { render, screen, waitFor } from '@testing-library/react'
import { createElement, type ImgHTMLAttributes } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NavRail } from '@/components/layout/nav-rail'
import { CustomerViewOverrides } from '@/components/panels/customer-view-overrides'
import { CUSTOMER_USER_PANELS, CUSTOMER_VISIBLE_PANELS, type EffectiveRole } from '@/lib/rbac'
import { useMissionControl } from '@/store'

vi.mock('next/image', () => ({
  default: ({ alt, src, ...props }: ImgHTMLAttributes<HTMLImageElement>) => (
    createElement('img', { alt, src: typeof src === 'string' ? src : '', ...props })
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/lib/navigation', () => ({
  buildPanelNavigationHref: (panel: string, options?: { role?: string | null }) => (
    `/${panel}?role=${options?.role || 'customer-admin'}`
  ),
  useNavigateToPanel: () => vi.fn(),
  usePrefetchPanel: () => vi.fn(),
}))

vi.mock('@/lib/plugins', () => ({
  getPluginNavItems: () => [],
}))

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  }
}

function expectNoInternalContent(container: HTMLElement) {
  expect(container.innerHTML).not.toMatch(/Mission Control/i)
  expect(container.innerHTML).not.toMatch(/OpenClaw/i)
  expect(container.innerHTML).not.toMatch(/github\.com/i)
  expect(container.innerHTML).not.toMatch(/SOUL\.md/i)
}

function setCustomerRole(role: Extract<EffectiveRole, 'customer-admin' | 'customer-user'>) {
  window.history.pushState({}, '', `/?role=${role}&tenant=wechat-mp-agent`)
  document.cookie = `mc-view-role=${role}; path=/`
}

async function renderCustomerPanels(role: Extract<EffectiveRole, 'customer-admin' | 'customer-user'>, panels: readonly string[]) {
  setCustomerRole(role)
  const rendered = render(
    <>
      {panels.map(panel => (
        <CustomerViewOverrides key={panel} panel={panel} />
      ))}
      <NavRail effectiveRole={role} />
    </>,
  )

  await waitFor(() => {
    expect(screen.queryByText('Loading UAT tasks...')).not.toBeInTheDocument()
  })

  return rendered
}

describe('customer content cleanup', () => {
  beforeEach(() => {
    setCustomerRole('customer-admin')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ tasks: [] }))))
    useMissionControl.setState({
      activeTab: 'overview',
      activeTenant: {
        id: 1,
        slug: 'wechat-mp-agent',
        display_name: 'CEO Assistant',
        status: 'active',
        linux_user: 'customer',
      },
      collapsedGroups: [],
      currentUser: null,
      dashboardMode: 'full',
      interfaceMode: 'full',
      sidebarExpanded: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.cookie = 'mc-view-role=; path=/; max-age=0'
    window.history.pushState({}, '', '/')
  })

  it('does not expose internal content on customer-admin visible panels', async () => {
    const { container, unmount } = await renderCustomerPanels('customer-admin', CUSTOMER_VISIBLE_PANELS)

    expectNoInternalContent(container)
    unmount()
  })

  it('does not expose internal content on customer-user visible panels', async () => {
    const { container, unmount } = await renderCustomerPanels('customer-user', CUSTOMER_USER_PANELS)

    expectNoInternalContent(container)
    unmount()
  })
})
