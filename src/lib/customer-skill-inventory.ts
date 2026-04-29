import 'server-only'

import { constants } from 'node:fs'
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { resolveWithin } from '@/lib/paths'
import { TENANT_ID_RE } from '@/lib/tenant-id'

export interface CustomerSkillInventoryItem {
  tenant_id: string
  skill_name: string
  title: string
  vault_path: string
  path: string
  excerpt: string
}

export interface CustomerSkillInventoryResult {
  skills: CustomerSkillInventoryItem[]
  total: number
}

async function canRead(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function extractSkillSummary(skillName: string, content: string): { title: string; excerpt: string } {
  const lines = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const heading = lines.find(line => line.startsWith('# '))
  const title = heading?.replace(/^#\s+/, '').trim() || skillName
  const excerpt = lines.find(line => !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('|')) || ''
  return {
    title,
    excerpt: excerpt.length > 180 ? `${excerpt.slice(0, 177)}...` : excerpt,
  }
}

export async function listTenantSkillInventory(): Promise<CustomerSkillInventoryResult> {
  const harnessRoot = await resolveHarnessRoot()
  const tenantsDir = resolveWithin(harnessRoot, 'phase0/tenants')
  if (!await canRead(tenantsDir)) return { skills: [], total: 0 }

  const tenantEntries = await readdir(tenantsDir, { withFileTypes: true })
  const skills: CustomerSkillInventoryItem[] = []

  for (const tenantEntry of tenantEntries) {
    if (!tenantEntry.isDirectory() || !TENANT_ID_RE.test(tenantEntry.name)) continue
    const tenantId = tenantEntry.name
    const skillsDir = resolveWithin(tenantsDir, `${tenantId}/vault/skills`)
    if (!await canRead(skillsDir)) continue

    const skillEntries = await readdir(skillsDir, { withFileTypes: true })
    for (const skillEntry of skillEntries) {
      if (!skillEntry.isFile() || !skillEntry.name.endsWith('.md')) continue
      const skillName = path.basename(skillEntry.name, '.md')
      if (!TENANT_ID_RE.test(skillName)) continue
      const relativePath = `phase0/tenants/${tenantId}/vault/skills/${skillEntry.name}`
      const physicalPath = resolveWithin(harnessRoot, relativePath)
      const content = await readFile(physicalPath, 'utf8')
      const summary = extractSkillSummary(skillName, content)
      skills.push({
        tenant_id: tenantId,
        skill_name: skillName,
        title: summary.title,
        vault_path: `vault/skills/${skillEntry.name}`,
        path: relativePath,
        excerpt: summary.excerpt,
      })
    }
  }

  skills.sort((left, right) => (
    left.tenant_id.localeCompare(right.tenant_id)
    || left.skill_name.localeCompare(right.skill_name)
  ))
  return { skills, total: skills.length }
}
