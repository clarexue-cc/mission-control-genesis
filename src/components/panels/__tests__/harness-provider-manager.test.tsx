import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HarnessProviderManager } from '@/components/panels/harness-provider-manager'

describe('HarnessProviderManager', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/harness/providers?tenantId=wechat-mp-agent') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            providers: [
              { name: 'openai', baseUrl: 'https://api.openai.com/v1', keyLast4: '1234' },
              { name: 'anthropic', baseUrl: 'https://api.anthropic.com', key_last4: 'abcd' },
            ],
          }),
        })
      }
      if (url === '/api/harness/providers' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ saved: true }) })
      }
      if (url === '/api/harness/providers/openai/test' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, latency_ms: 88 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ providers: [] }) })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads provider cards, saves a custom provider, and tests a connection', async () => {
    render(<HarnessProviderManager />)

    expect(await screen.findByRole('heading', { name: 'Harness providers', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Tenant' })).toHaveValue('wechat-mp-agent')
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.getByText('•••• 1234')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
    expect(screen.getByText('•••• abcd')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Provider name'), { target: { value: 'moonshot' } })
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.moonshot.cn/v1' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-moonshot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }))

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/harness/providers', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tenantId: 'wechat-mp-agent',
          name: 'moonshot',
          baseUrl: 'https://api.moonshot.cn/v1',
          apiKey: 'sk-moonshot',
        }),
      }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test openai' }))

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/harness/providers/openai/test', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tenantId: 'wechat-mp-agent' }),
      }))
    })
    expect(await screen.findByText('openai OK')).toBeInTheDocument()
  })
})
