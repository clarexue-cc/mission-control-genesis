import { requireHermesAdmin } from '@/app/onboarding/hermes/_lib/auth'
import { HermesBlueprintClient } from './blueprint-client'

export default async function HermesBlueprintPage() {
  await requireHermesAdmin('/onboarding/hermes/blueprint')
  return <HermesBlueprintClient />
}
