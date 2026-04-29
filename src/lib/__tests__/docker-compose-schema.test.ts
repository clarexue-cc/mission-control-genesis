import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Tests that docker-compose.yml and Dockerfile contain the expected
 * configuration for Compose v5+ compatibility and complete runtime assets.
 */

const ROOT = resolve(__dirname, '../../..')

describe('docker-compose.yml schema', () => {
  const content = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf-8')

  it('uses deploy.resources.limits.pids (not service-level pids_limit)', () => {
    // pids limit must be inside deploy.resources.limits for Compose v5+ compatibility.
    // Service-level pids_limit causes "can't set distinct values" errors on some versions.
    expect(content).not.toContain('pids_limit:')

    const deployBlock = content.match(/deploy:[\s\S]*?(?=\n\s{4}\w|\nvolumes:|\nnetworks:)/)?.[0] ?? ''
    expect(deployBlock).toContain('pids:')
  })

  it('still has memory and cpus in deploy.resources.limits', () => {
    expect(content).toContain('memory:')
    expect(content).toContain('cpus:')
  })

  it('mounts the tenant vault source of truth at /vault', () => {
    expect(content).toContain('- VAULT_PATH=/vault')
    expect(content).toContain('- ./phase0/tenants/${TENANT_ID:-demo-arch-test-tenant}/vault:/vault')
    expect(content).not.toContain('/Users/clare/Desktop/obsidian/openclaw')
  })
})

describe('Dockerfile runtime stage', () => {
  const content = readFileSync(resolve(ROOT, 'Dockerfile'), 'utf-8')

  it('copies public directory to runtime stage', () => {
    expect(content).toContain('COPY --from=build /app/public ./public')
  })

  it('copies standalone output', () => {
    expect(content).toContain('COPY --from=build /app/.next/standalone ./')
  })

  it('copies static assets', () => {
    expect(content).toContain('COPY --from=build /app/.next/static ./.next/static')
  })

  it('copies schema.sql for migrations', () => {
    expect(content).toContain('schema.sql')
  })

  it('does not copy tenant vault data into the runtime image', () => {
    expect(content).not.toContain('COPY phase0/tenants')
    expect(content).not.toContain('COPY --from=build /app/phase0/tenants')
  })
})
