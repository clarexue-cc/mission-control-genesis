import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = process.cwd()
const scriptPath = path.join(repoRoot, 'phase0/scripts/new-tenant.sh')

describe('phase0/scripts/new-tenant.sh', () => {
  let tempDir = ''
  let harnessRoot = ''
  let obsidianRoot = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mc-new-tenant-'))
    harnessRoot = path.join(tempDir, 'mission-control')
    obsidianRoot = path.join(tempDir, 'obsidian', 'openclaw')

    await mkdir(path.join(harnessRoot, 'phase0/templates/vault-template/Agent-Shared'), { recursive: true })
    await writeFile(path.join(harnessRoot, 'package.json'), '{"name":"mission-control-test"}\n', 'utf8')
    await writeFile(path.join(harnessRoot, 'phase0/templates/vault-template/index.md'), '# Tenant Vault Template\n', 'utf8')
    await writeFile(path.join(harnessRoot, 'phase0/templates/vault-template/Agent-Shared/project-state.md'), '# Project State\n', 'utf8')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates a tenant vault source and an Obsidian symlink view pointing to it', async () => {
    await execFileAsync('bash', [scriptPath, 'demo-arch-test-tenant'], {
      cwd: harnessRoot,
      env: {
        ...process.env,
        MC_HARNESS_ROOT: harnessRoot,
        MC_OBSIDIAN_VAULT_ROOT: obsidianRoot,
      },
    })

    const sourceVault = path.join(harnessRoot, 'phase0/tenants/demo-arch-test-tenant/vault')
    const obsidianView = path.join(obsidianRoot, 'demo-arch-test-tenant')
    const viewStats = await lstat(obsidianView)
    const realSourceVault = await realpath(sourceVault)

    expect(viewStats.isSymbolicLink()).toBe(true)
    expect(await readlink(obsidianView)).toBe(realSourceVault)
    expect(await realpath(obsidianView)).toBe(realSourceVault)
    await expect(readFile(path.join(obsidianView, 'Agent-Shared/project-state.md'), 'utf8'))
      .resolves.toBe(await readFile(path.join(sourceVault, 'Agent-Shared/project-state.md'), 'utf8'))
  })
})
