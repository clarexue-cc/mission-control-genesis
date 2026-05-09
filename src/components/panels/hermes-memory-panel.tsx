'use client'

import { HermesOperationPanel } from '@/components/panels/hermes-operation-panel'

export function HermesMemoryPanel() {
  return (
    <HermesOperationPanel
      stage="H-04"
      title="Hermes Memory Curator"
      endpoint="/api/harness/hermes/memory"
      defaultValues={{
        memoriesDir: 'phase0/tenants/tenant-test-001/memory/memories',
        configPath: 'phase0/tenants/tenant-test-001/memory/memory-config.json',
        tenantId: 'tenant-test-001',
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
