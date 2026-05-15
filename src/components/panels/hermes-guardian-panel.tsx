'use client'

import { HermesOperationPanel } from '@/components/panels/hermes-operation-panel'
import { useMissionControl } from '@/store'

export function HermesGuardianPanel() {
  const { activeTenant } = useMissionControl()
  const tenantSlug = activeTenant?.slug || 'tenant-test-001'

  return (
    <HermesOperationPanel
      stage="H-06"
      title="Hermes Guardian V2"
      endpoint="/api/harness/hermes/guardian"
      defaultValues={{
        gatewayUrl: 'http://localhost:3000/health',
        profileDir: `phase0/tenants/${tenantSlug}`,
        haltSignal: `phase0/tenants/${tenantSlug}/halt-signal.json`,
        budgetFile: `phase0/tenants/${tenantSlug}/budget.json`,
        usageLog: `phase0/tenants/${tenantSlug}/logs/token-usage.jsonl`,
        tokens: '1500',
        model: 'claude-sonnet-4-20250514',
      }}
      fields={[
        { name: 'gatewayUrl', label: 'Gateway URL' },
        { name: 'profileDir', label: 'Profile dir' },
        { name: 'haltSignal', label: 'Halt signal' },
        { name: 'budgetFile', label: 'Budget file' },
        { name: 'usageLog', label: 'Usage log' },
        { name: 'tokens', label: 'Tokens', type: 'number' },
        { name: 'model', label: 'Model' },
      ]}
      actions={[
        { id: 'gateway-health', label: 'Gateway Health', body: { module: 'gateway-health', action: 'check' } },
        { id: 'diagnose', label: 'Diagnose Profile', body: { module: 'profile-recovery', action: 'diagnose' } },
        { id: 'recover', label: 'Recover Profile', variant: 'success', body: { module: 'profile-recovery', action: 'recover' } },
        { id: 'halt-check', label: 'Halt Check', body: { module: 'halt-reader', action: 'check' } },
        { id: 'halt-clear', label: 'Clear Halt', variant: 'destructive', body: { module: 'halt-reader', action: 'clear' } },
        { id: 'budget-check', label: 'Budget Check', body: { module: 'token-budget', action: 'check' } },
        { id: 'budget-record', label: 'Record Tokens', variant: 'secondary', body: { module: 'token-budget', action: 'record' } },
      ]}
    />
  )
}
