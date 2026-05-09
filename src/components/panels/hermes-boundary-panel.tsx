'use client'

import { HermesOperationPanel } from '@/components/panels/hermes-operation-panel'

export function HermesBoundaryPanel() {
  return (
    <HermesOperationPanel
      stage="H-02"
      title="Hermes Boundary Watchdog"
      endpoint="/api/harness/hermes/boundary"
      defaultValues={{
        sessionsDir: 'phase0/tenants/tenant-test-001/sessions',
        rulesPath: 'phase0/tenants/tenant-test-001/boundary/boundary-rules.json',
      }}
      fields={[
        { name: 'sessionsDir', label: 'Sessions dir' },
        { name: 'rulesPath', label: 'Rules path' },
      ]}
      actions={[
        { id: 'scan', label: 'Scan', body: { action: 'scan' } },
      ]}
    />
  )
}
