import { requireHermesAdmin } from '@/app/onboarding/hermes/_lib/auth'
import { HermesDeployClient } from './deploy-client'

export default async function HermesDeployPage() {
  await requireHermesAdmin('/onboarding/hermes/deploy')
  return <HermesDeployClient />
}
