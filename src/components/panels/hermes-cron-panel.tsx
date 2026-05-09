'use client'

import { HermesOperationPanel } from '@/components/panels/hermes-operation-panel'

export function HermesCronPanel() {
  return (
    <HermesOperationPanel
      stage="H-07"
      title="Hermes Cron Governance"
      endpoint="/api/harness/hermes/cron"
      defaultValues={{
        cronDir: 'phase0/tenants/tenant-test-001/cron',
        cronName: 'daily-search',
        budgetFile: 'phase0/tenants/tenant-test-001/budget.json',
        status: 'success',
        tokens: '3200',
        durationMs: '45000',
        reason: '',
      }}
      fields={[
        { name: 'cronDir', label: 'Cron dir' },
        { name: 'cronName', label: 'Cron name' },
        { name: 'budgetFile', label: 'Budget file' },
        {
          name: 'status',
          label: 'Execution status',
          type: 'select',
          options: [
            { label: 'success', value: 'success' },
            { label: 'failed', value: 'failed' },
            { label: 'warning', value: 'warning' },
          ],
        },
        { name: 'tokens', label: 'Tokens', type: 'number' },
        { name: 'durationMs', label: 'Duration ms', type: 'number' },
        { name: 'reason', label: 'Revoke reason' },
      ]}
      actions={[
        { id: 'list', label: 'List', body: { action: 'list' } },
        { id: 'audit', label: 'Audit', body: { action: 'audit' } },
        { id: 'approve', label: 'Approve', variant: 'success', body: { action: 'approve' } },
        { id: 'revoke', label: 'Revoke', variant: 'destructive', body: { action: 'revoke' } },
        { id: 'log-execution', label: 'Log Execution', variant: 'secondary', body: { action: 'log-execution' } },
        { id: 'cost-check', label: 'Cost Check', body: { action: 'cost-check' } },
      ]}
    />
  )
}
