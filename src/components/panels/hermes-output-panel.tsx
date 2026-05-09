'use client'

import { HermesOperationPanel } from '@/components/panels/hermes-operation-panel'

export function HermesOutputPanel() {
  return (
    <HermesOperationPanel
      stage="H-05"
      title="Hermes Output Checker"
      endpoint="/api/harness/hermes/output"
      defaultValues={{
        sessionsDir: 'phase0/tenants/tenant-test-001/sessions',
        filePath: '',
        configPath: 'phase0/tenants/tenant-test-001/output-checker-config.json',
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
