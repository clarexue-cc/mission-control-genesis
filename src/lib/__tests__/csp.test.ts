import { afterEach, describe, expect, it } from 'vitest'
import { buildMissionControlCsp, buildNonceRequestHeaders } from '@/lib/csp'

const env = process.env as Record<string, string | undefined>
const originalNodeEnv = env.NODE_ENV

afterEach(() => {
  if (originalNodeEnv === undefined) delete env.NODE_ENV
  else env.NODE_ENV = originalNodeEnv
})

describe('buildMissionControlCsp', () => {
  it('includes the request nonce in script and style directives', () => {
    const csp = buildMissionControlCsp({ nonce: 'nonce-123', googleEnabled: false })

    expect(csp).toContain(`script-src 'self' 'nonce-nonce-123' 'strict-dynamic'`)
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("style-src-elem 'self' 'unsafe-inline'")
    expect(csp).toContain("style-src-attr 'unsafe-inline'")
  })

  it('allows unsafe-eval only in development for Next.js HMR/debugging', () => {
    env.NODE_ENV = 'development'
    const csp = buildMissionControlCsp({ nonce: 'nonce-123', googleEnabled: false })

    expect(csp).toContain(`script-src 'self' 'nonce-nonce-123' 'strict-dynamic' 'unsafe-eval'`)
  })

  it('does not allow unsafe-eval in production', () => {
    env.NODE_ENV = 'production'
    const csp = buildMissionControlCsp({ nonce: 'nonce-123', googleEnabled: false })

    expect(csp).not.toContain("'unsafe-eval'")
  })
})

describe('buildNonceRequestHeaders', () => {
  it('propagates nonce and CSP into request headers for Next.js rendering', () => {
    const headers = buildNonceRequestHeaders({
      headers: new Headers({ host: 'localhost:3000' }),
      nonce: 'nonce-123',
      googleEnabled: false,
    })

    expect(headers.get('x-nonce')).toBe('nonce-123')
    expect(headers.get('Content-Security-Policy')).toContain("style-src 'self' 'unsafe-inline'")
  })
})
