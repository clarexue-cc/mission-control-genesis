import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const scriptPath = path.join(process.cwd(), 'phase0/scripts/hermes-daemon.sh')

describe('phase0/scripts/hermes-daemon.sh permissions', () => {
  let tempDir = ''
  let vaultRoot = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mc-hermes-daemon-'))
    vaultRoot = path.join(tempDir, 'vault')
    await mkdir(path.join(vaultRoot, 'Agent-Shared'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'Agent-demo-arch-test-tenant'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'Agent-demo-arch-test-tenant/working-context.md'), '# Working Context\n', 'utf8')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('writes the shared Hermes log when using the whitelist path', async () => {
    await execFileAsync('bash', [scriptPath, 'once'], {
      env: {
        ...process.env,
        MC_OBSIDIAN_VAULT_ROOT: vaultRoot,
        HERMES_LOG_FILE: path.join(vaultRoot, 'Agent-Shared/hermes-log.md'),
      },
    })
  })

  it('fails before writing when the Hermes log path targets a blacklisted file', async () => {
    await expect(execFileAsync('bash', [scriptPath, 'once'], {
      env: {
        ...process.env,
        MC_OBSIDIAN_VAULT_ROOT: vaultRoot,
        HERMES_LOG_FILE: path.join(vaultRoot, 'Agent-demo-arch-test-tenant/SOUL.md'),
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('Hermes write denied'),
    })
  })
})
