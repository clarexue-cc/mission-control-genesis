'use client'

import { HermesOperationPanel } from '@/components/panels/hermes-operation-panel'

export function HermesProfileSetupPanel() {
  return (
    <HermesOperationPanel
      stage="H-01"
      title="Hermes Profile Setup"
      endpoint="/api/harness/hermes/profile-setup"
      defaultValues={{
        intakePath: 'phase0/tenants/tenant-test-001/intake/client-intake-filled.md',
        outputPath: 'phase0/tenants/tenant-test-001',
      }}
      fields={[
        { name: 'intakePath', label: 'Intake path' },
        { name: 'outputPath', label: 'Output path' },
      ]}
      actions={[
        { id: 'dry-run', label: 'Dry Run', variant: 'secondary', body: { action: 'dry-run', dryRun: true } },
        { id: 'generate', label: 'Generate', variant: 'success', body: { action: 'generate', dryRun: false } },
      ]}
    />
  )
}
