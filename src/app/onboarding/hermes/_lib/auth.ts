import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateSession } from '@/lib/auth'
import { LEGACY_MC_SESSION_COOKIE_NAME, MC_SESSION_COOKIE_NAME } from '@/lib/session-cookie'

export async function requireHermesAdmin(nextPath: string) {
  const cookieStore = await cookies()
  const token = cookieStore.get(MC_SESSION_COOKIE_NAME)?.value
    || cookieStore.get(LEGACY_MC_SESSION_COOKIE_NAME)?.value
  const user = token ? validateSession(token) : null

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }
  if (user.role !== 'admin') {
    redirect('/')
  }

  return user
}
