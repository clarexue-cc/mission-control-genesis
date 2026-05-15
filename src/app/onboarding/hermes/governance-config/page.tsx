import { requireHermesAdmin } from '@/app/onboarding/hermes/_lib/auth'
import { HermesGovernanceConfigClient } from './governance-config-client'

export default async function HermesGovernanceConfigPage() {
  await requireHermesAdmin('/onboarding/hermes/governance-config')
  return <HermesGovernanceConfigClient />
}
