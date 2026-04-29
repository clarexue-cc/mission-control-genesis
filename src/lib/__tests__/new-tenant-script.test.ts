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

  it('interpolates markdown templates from a P4 blueprint with graceful placeholder fallback', async () => {
    await mkdir(path.join(harnessRoot, 'phase0/templates/vault-template/Agent-TEMPLATE'), { recursive: true })
    await writeFile(
      path.join(harnessRoot, 'phase0/templates/vault-template/index.md'),
      '# {{TENANT_NAME}} Vault\n\n## Delivery\n{{DELIVERY_MODE}}\n\n## Missing\n{{OPTIONAL_NOTE}}\n',
      'utf8',
    )
    await writeFile(
      path.join(harnessRoot, 'phase0/templates/vault-template/Agent-TEMPLATE/working-context.md'),
      '# {{TENANT_NAME}} Working Context\n\n## Role\n{{ROLE}}\n\n## Tone\n{{TONE}}\n',
      'utf8',
    )
    const blueprintPath = path.join(tempDir, 'p4-blueprint.json')
    await writeFile(blueprintPath, JSON.stringify({
      tenant_id: 'demo-arch-test-tenant',
      tenant_name: 'Demo Arch Tenant',
      delivery_mode: 'Hybrid',
      soul_draft: {
        name: 'Demo Research Agent',
        role: 'Read customer signals and prepare review-ready briefings.',
        tone: 'Calm and evidence-first.',
      },
    }, null, 2), 'utf8')

    await execFileAsync('bash', [scriptPath, 'demo-arch-test-tenant', blueprintPath], {
      cwd: harnessRoot,
      env: {
        ...process.env,
        MC_HARNESS_ROOT: harnessRoot,
        MC_OBSIDIAN_VAULT_ROOT: obsidianRoot,
      },
    })

    const vaultRoot = path.join(harnessRoot, 'phase0/tenants/demo-arch-test-tenant/vault')
    const index = await readFile(path.join(vaultRoot, 'index.md'), 'utf8')
    const context = await readFile(path.join(vaultRoot, 'Agent-TEMPLATE/working-context.md'), 'utf8')

    expect(index).toContain('# Demo Arch Tenant Vault')
    expect(index).toContain('Hybrid')
    expect(index).toContain('[missing: OPTIONAL_NOTE]')
    expect(index).not.toMatch(/{{\s*[A-Z0-9_]+\s*}}/)
    expect(context).toContain('## Role\nRead customer signals and prepare review-ready briefings.')
    expect(context).toContain('## Tone\nCalm and evidence-first.')
    expect(context).not.toMatch(/{{\s*[A-Z0-9_]+\s*}}/)
  })
})
