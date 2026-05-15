import { requireHermesAdmin } from '@/app/onboarding/hermes/_lib/auth'
import { HermesApprovalClient } from './approval-client'

export default async function HermesApprovalPage() {
  await requireHermesAdmin('/onboarding/hermes/approval')
  return <HermesApprovalClient />
}
