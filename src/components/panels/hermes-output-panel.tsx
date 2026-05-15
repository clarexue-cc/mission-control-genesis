'use client'

import { HermesOperationPanel } from '@/components/panels/hermes-operation-panel'
import { useMissionControl } from '@/store'

export function HermesOutputPanel() {
  const { activeTenant } = useMissionControl()
  const tenantSlug = activeTenant?.slug || 'tenant-test-001'

  return (
    <HermesOperationPanel
      stage="H-05"
      title="Hermes Output Checker"
      endpoint="/api/harness/hermes/output"
      defaultValues={{
        sessionsDir: `phase0/tenants/${tenantSlug}/sessions`,
        filePath: '',
        configPath: `phase0/tenants/${tenantSlug}/output-checker-config.json`,
      }}
      fields={[
        { name: 'sessionsDir', label: 'Sessions dir' },
        { name: 'filePath', label: 'Single file' },
        { name: 'configPath', label: 'Checker config' },
      ]}
      actions={[
        { id: 'check', label: 'Check', body: { action: 'check' } },
      ]}
    />
  )
}
