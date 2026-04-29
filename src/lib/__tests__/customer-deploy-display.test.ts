import { describe, expect, it } from 'vitest'
import {
  getCustomerDeployStatusDisplay,
  P6_MOCK_FALLBACK_NOTICE,
} from '@/lib/customer-deploy-display'

describe('customer deploy display copy', () => {
  it('shows mock fallback deploys as friendly dev-preview containers without mutating the contract', () => {
    const deployStatus = {
      status: 'mock-success',
      mode: 'mock-fallback',
      container: 'tenant-ceo-assistant-v1-mock',
    }

    const display = getCustomerDeployStatusDisplay(deployStatus, 'ceo-assistant-v1')

    expect(display.containerName).toBe('ceo-assistant-v1-dev-preview')
    expect(display.modeLabel).toBe('开发预览容器（dev-preview）')
    expect(display.statusLabel).toBe('成功（开发预览）')
    expect(display.notice).toBe(P6_MOCK_FALLBACK_NOTICE)
    expect(display.notice).toContain('docker-compose.yml 启动 OpenClaw 容器')
    expect(deployStatus.mode).toBe('mock-fallback')
    expect(deployStatus.container).toBe('tenant-ceo-assistant-v1-mock')
  })

  it('keeps real deployment labels and container names intact', () => {
    const display = getCustomerDeployStatusDisplay({
      status: 'success',
      mode: 'new-tenant-script',
      container: 'tenant-ceo-assistant-v1-script',
    }, 'ceo-assistant-v1')

    expect(display.containerName).toBe('tenant-ceo-assistant-v1-script')
    expect(display.modeLabel).toBe('new-tenant-script')
    expect(display.statusLabel).toBe('success')
    expect(display.notice).toBeNull()
  })
})
