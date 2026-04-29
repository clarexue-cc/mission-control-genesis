import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertHermesVaultWriteAllowed,
  readHermesVaultFile,
  writeHermesVaultFile,
} from '@/lib/hermes-vault-permissions'

describe('Hermes vault permissions', () => {
  let tempDir = ''
  let vaultRoot = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mc-hermes-perm-'))
    vaultRoot = path.join(tempDir, 'vault')
    await mkdir(path.join(vaultRoot, 'Agent-Shared'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'Agent-demo-arch-test-tenant'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'skills'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'Agent-demo-arch-test-tenant/SOUL.md'), '# Soul\n', 'utf8')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('allows Hermes to write only its shared log artifacts', async () => {
    await writeHermesVaultFile(vaultRoot, 'Agent-Shared/hermes-log.md', '# Hermes\n')
    await writeHermesVaultFile(vaultRoot, 'Agent-Shared/hermes-alerts.jsonl', '{"ok":true}\n')

    await expect(readFile(path.join(vaultRoot, 'Agent-Shared/hermes-log.md'), 'utf8')).resolves.toContain('# Hermes')
    await expect(readFile(path.join(vaultRoot, 'Agent-Shared/hermes-alerts.jsonl'), 'utf8')).resolves.toContain('"ok":true')
  })

  it.each([
    'Agent-demo-arch-test-tenant/SOUL.md',
    'Agent-demo-arch-test-tenant/AGENTS.md',
    'skills/research.md',
    'intake-raw.md',
    'intake-analysis.md',
  ])('rejects Hermes writes to %s', async (relativePath) => {
    expect(() => assertHermesVaultWriteAllowed(vaultRoot, relativePath)).toThrow('Hermes write denied')
    await expect(writeHermesVaultFile(vaultRoot, relativePath, 'blocked')).rejects.toThrow('Hermes write denied')
  })

  it('does not restrict reads inside the vault', async () => {
    await expect(readHermesVaultFile(vaultRoot, 'Agent-demo-arch-test-tenant/SOUL.md')).resolves.toContain('# Soul')
  })
})
