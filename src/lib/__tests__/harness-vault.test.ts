import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tenants = ['ceo-assistant-v1', 'media-intel-v1', 'web3-research-v1'] as const

vi.mock('@/lib/harness-boundary', () => ({
  BOUNDARY_TENANTS: tenants,
  normalizeBoundaryTenant: (value: unknown) => {
    if (typeof value === 'string' && tenants.includes(value as any)) return value
    throw new Error(`tenant must be one of: ${tenants.join(', ')}`)
  },
  resolveHarnessRoot: async () => process.env.MC_HARNESS_ROOT,
}))

describe('harness vault helpers', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''
  let harnessRoot = ''
  let vaultRoot = ''

  async function loadVaultModule() {
    vi.resetModules()
    return import('@/lib/harness-vault')
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mc-harness-vault-'))
    harnessRoot = path.join(tempDir, 'genesis-harness')
    vaultRoot = path.join(tempDir, 'openclaw-vault')

    await mkdir(path.join(harnessRoot, 'phase0/templates/vault-template/Agent-TEMPLATE'), { recursive: true })
    await mkdir(path.join(harnessRoot, 'phase0/templates/vault-template/Agent-Shared'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'Agent-Shared'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'Agent-Main'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'Agent-MediaIntel'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'Agent-Web3Research'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'skills'), { recursive: true })

    await writeFile(path.join(vaultRoot, 'Agent-Shared/project-state.md'), '# Project State\n', 'utf8')
    await writeFile(path.join(vaultRoot, 'Agent-Main/working-context.md'), '# Main Context\n', 'utf8')
    await writeFile(path.join(vaultRoot, 'Agent-MediaIntel/AGENTS.md'), '# Media Intel Agent\n', 'utf8')
    await writeFile(path.join(vaultRoot, 'Agent-Web3Research/AGENTS.md'), '# Web3 Research Agent\n', 'utf8')
    await writeFile(path.join(vaultRoot, 'skills/search.md'), '# Search Skill\n', 'utf8')
    await writeFile(path.join(harnessRoot, 'phase0/templates/vault-template/Agent-TEMPLATE/AGENTS.md'), '# Template Agent\n', 'utf8')

    process.env = {
      ...originalEnv,
      MC_HARNESS_ROOT: harnessRoot,
      MC_OBSIDIAN_VAULT_ROOT: vaultRoot,
      MC_OBSIDIAN_VAULT_NAME: 'test-vault',
    }
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    vi.resetModules()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('reads a normal vault file and uses the tenant dedicated agent directory', async () => {
    const { readVaultFile, readVaultTree } = await loadVaultModule()

    const file = await readVaultFile('ceo-assistant-v1', 'Agent-Shared/project-state.md')
    expect(file.content).toContain('Project State')
    expect(file.obsidian_deeplink).toBe('obsidian://open?vault=test-vault&file=Agent-Shared%2Fproject-state.md')

    const tree = await readVaultTree('media-intel-v1')
    expect(tree.tree.map(node => node.name)).toContain('Agent-MediaIntel')
    expect(tree.tree.map(node => node.name)).not.toContain('Agent-HarnessTester')
  })

  it('rejects parent-directory traversal in logical paths', async () => {
    const { readVaultFile } = await loadVaultModule()

    await expect(readVaultFile('ceo-assistant-v1', 'Agent-Shared/../project-state.md')).rejects.toThrow('Invalid vault path')
  })

  it('rejects absolute filesystem paths', async () => {
    const { readVaultFile } = await loadVaultModule()
    const absolutePath = path.join(vaultRoot, 'Agent-Shared/project-state.md')

    await expect(readVaultFile('ceo-assistant-v1', absolutePath)).rejects.toThrow('Invalid vault path')
  })

  it('rejects tenants outside BOUNDARY_TENANTS', async () => {
    const { readVaultTree } = await loadVaultModule()

    await expect(readVaultTree('unknown-tenant' as any)).rejects.toThrow('tenant must be one of')
  })

  it('returns virtual intake files when tenant intake files are absent', async () => {
    const { readVaultFile } = await loadVaultModule()

    const file = await readVaultFile('web3-research-v1', 'intake-analysis.md')
    expect(file.virtual).toBe(true)
    expect(file.physical_path).toBeNull()
    expect(file.content).toContain('Tenant: web3-research-v1')
  })
})
