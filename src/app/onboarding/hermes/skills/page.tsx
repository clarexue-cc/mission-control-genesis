import { requireHermesAdmin } from '@/app/onboarding/hermes/_lib/auth'
import { HermesSkillsClient } from './skills-client'

export default async function HermesSkillsPage() {
  await requireHermesAdmin('/onboarding/hermes/skills')
  return <HermesSkillsClient />
}
