'use client'

import { HermesOperationPanel } from '@/components/panels/hermes-operation-panel'

export function HermesSkillCuratorPanel() {
  return (
    <HermesOperationPanel
      stage="H-03"
      title="Hermes Skill Curator"
      endpoint="/api/harness/hermes/skill-curator"
      defaultValues={{
        skillsDir: 'phase0/tenants/tenant-test-001/skills',
        configPath: 'phase0/tenants/tenant-test-001/approved-skills.json',
        backupDir: 'phase0/tenants/tenant-test-001/skills-backup',
      }}
      fields={[
        { name: 'skillsDir', label: 'Skills dir' },
        { name: 'configPath', label: 'Approved config' },
        { name: 'backupDir', label: 'Backup dir' },
      ]}
      actions={[
        { id: 'check', label: 'Check', body: { action: 'check' } },
        { id: 'snapshot', label: 'Snapshot', variant: 'secondary', body: { action: 'snapshot' } },
        { id: 'restore', label: 'Restore', variant: 'success', body: { action: 'restore' } },
      ]}
    />
  )
}
