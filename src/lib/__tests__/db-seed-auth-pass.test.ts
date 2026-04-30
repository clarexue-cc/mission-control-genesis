import { describe, expect, it } from 'vitest'
import { resolveSeedAuthPassword, resolveSeedAuthUsername } from '../db'

describe('resolveSeedAuthPassword', () => {
  it('returns AUTH_PASS when AUTH_PASS_B64 is not set', () => {
    const password = resolveSeedAuthPassword({ AUTH_PASS: 'plain-secret-123' } as unknown as NodeJS.ProcessEnv)
    expect(password).toBe('plain-secret-123')
  })

  it('prefers AUTH_PASS_B64 when present and valid', () => {
    const encoded = Buffer.from('secret#with#hash', 'utf8').toString('base64')
    const password = resolveSeedAuthPassword({
      AUTH_PASS: 'fallback-value',
      AUTH_PASS_B64: encoded,
    } as unknown as NodeJS.ProcessEnv)
    expect(password).toBe('secret#with#hash')
  })

  it('falls back to AUTH_PASS when AUTH_PASS_B64 is invalid', () => {
    const password = resolveSeedAuthPassword({
      AUTH_PASS: 'fallback-value',
      AUTH_PASS_B64: '%%%not-base64%%%',
    } as unknown as NodeJS.ProcessEnv)
    expect(password).toBe('fallback-value')
  })

  it('returns null when no password env var is set', () => {
    const password = resolveSeedAuthPassword({} as unknown as NodeJS.ProcessEnv)
    expect(password).toBeNull()
  })

  it('uses the fixed dev preview account when no auth env is set', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

    expect(resolveSeedAuthUsername(env)).toBe('clare-admin')
    expect(resolveSeedAuthPassword(env)).toBe('dev-test-123')
  })

  it('does not replace explicit auth env in dev preview mode', () => {
    const env = {
      NODE_ENV: 'development',
      AUTH_USER: 'custom-admin',
      AUTH_PASS: 'custom-password-123',
    } as unknown as NodeJS.ProcessEnv

    expect(resolveSeedAuthUsername(env)).toBe('custom-admin')
    expect(resolveSeedAuthPassword(env)).toBe('custom-password-123')
  })
})
