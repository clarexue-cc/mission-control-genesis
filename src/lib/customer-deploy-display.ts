export interface CustomerDeployStatusDisplayInput {
  status?: string | null
  mode?: string | null
  container?: string | null
}

export interface CustomerDeployStatusDisplay {
  containerName: string
  modeLabel: string
  statusLabel: string
  notice: string | null
}

export const P6_MOCK_FALLBACK_NOTICE = '真实生产部署需配 docker-compose.yml 启动 OpenClaw 容器（panorama v6 闸门 2 任务）'

function isMockFallbackDeploy(status?: CustomerDeployStatusDisplayInput | null): boolean {
  return status?.mode === 'mock-fallback' || status?.status === 'mock-success'
}

export function getCustomerDeployStatusDisplay(
  status: CustomerDeployStatusDisplayInput | null | undefined,
  tenantId: string,
): CustomerDeployStatusDisplay {
  if (!status) {
    return {
      containerName: '未生成',
      modeLabel: '未生成',
      statusLabel: '未生成',
      notice: null,
    }
  }

  if (isMockFallbackDeploy(status)) {
    return {
      containerName: `${tenantId}-dev-preview`,
      modeLabel: '开发预览容器（dev-preview）',
      statusLabel: '成功（开发预览）',
      notice: P6_MOCK_FALLBACK_NOTICE,
    }
  }

  return {
    containerName: status.container || '未生成',
    modeLabel: status.mode || '未生成',
    statusLabel: status.status || '未生成',
    notice: null,
  }
}
