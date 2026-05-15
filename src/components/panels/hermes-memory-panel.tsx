'use client'

import { HermesOperationPanel } from '@/components/panels/hermes-operation-panel'
import { useMissionControl } from '@/store'

export function HermesMemoryPanel() {
  const { activeTenant } = useMissionControl()
  const tenantSlug = activeTenant?.slug || 'tenant-test-001'

  return (
    <HermesOperationPanel
      stage="H-04"
      title="Hermes Memory Curator"
      endpoint="/api/harness/hermes/memory"
      defaultValues={{
        memoriesDir: `phase0/tenants/${tenantSlug}/memory/memories`,
        configPath: `phase0/tenants/${tenantSlug}/memory/memory-config.json`,
        tenantId: tenantSlug,
      }}
      fields={[
        { name: 'memoriesDir', label: 'Memories dir' },
        { name: 'configPath', label: 'Memory config' },
        { name: 'tenantId', label: 'Tenant id' },
      ]}
      actions={[
        { id: 'audit', label: 'Audit', body: { action: 'audit' } },
        { id: 'curate', label: 'Curate', variant: 'secondary', body: { action: 'curate' } },
        { id: 'check-isolation', label: 'Check Isolation', body: { action: 'check-isolation' } },
      ]}
    />
  )
}
