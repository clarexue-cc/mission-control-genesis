#!/usr/bin/env bash
set -euo pipefail

TENANT_ID="${1:-}"
BLUEPRINT_PATH="${2:-${P4_BLUEPRINT_PATH:-${CUSTOMER_BLUEPRINT_PATH:-}}}"
TENANT_ID_RE='^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'

if [[ ! "$TENANT_ID" =~ $TENANT_ID_RE ]]; then
  echo "usage: $0 <tenant-id>" >&2
  echo "tenant-id must use lowercase letters, numbers, and hyphens" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEFAULT_HARNESS_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
HARNESS_ROOT="$(cd "${MC_HARNESS_ROOT:-$DEFAULT_HARNESS_ROOT}" && pwd -P)"
TEMPLATE_ROOT="$HARNESS_ROOT/phase0/templates/vault-template"
TENANT_ROOT="$HARNESS_ROOT/phase0/tenants/$TENANT_ID"
VAULT_ROOT="$TENANT_ROOT/vault"
OBSIDIAN_ROOT="${MC_OBSIDIAN_VAULT_ROOT:-${OBSIDIAN_VAULT_ROOT:-$HOME/Desktop/obsidian/openclaw}}"
OBSIDIAN_VIEW="$OBSIDIAN_ROOT/$TENANT_ID"

if [ ! -d "$TEMPLATE_ROOT" ]; then
  echo "vault template not found: $TEMPLATE_ROOT" >&2
  exit 1
fi

mkdir -p "$TENANT_ROOT"
CREATED_VAULT=0
if [ ! -d "$VAULT_ROOT" ]; then
  cp -R "$TEMPLATE_ROOT" "$VAULT_ROOT"
  CREATED_VAULT=1
fi

if [ "$CREATED_VAULT" -eq 1 ]; then
  TENANT_ID="$TENANT_ID" VAULT_ROOT="$VAULT_ROOT" BLUEPRINT_PATH="$BLUEPRINT_PATH" node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

const tenantId = process.env.TENANT_ID
const vaultRoot = process.env.VAULT_ROOT
const blueprintPath = process.env.BLUEPRINT_PATH || ''

function clean(value) {
  return typeof value === 'string' ? value.replace(/[\0\r]/g, '').trim() : ''
}

function readBlueprint(filePath) {
  if (!filePath) return {}
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    console.warn(`warning: could not read P4 blueprint ${filePath}: ${error.message}`)
    return {}
  }
}

function list(values) {
  if (!Array.isArray(values) || values.length === 0) return ''
  return values.map((value) => {
    if (typeof value === 'string') return `- ${clean(value)}`
    if (value && typeof value === 'object') {
      const id = clean(value.id || value.name || value.title)
      const title = clean(value.title || value.reason || value.workflow_stage)
      return `- ${[id, title].filter(Boolean).join(': ')}`
    }
    return `- ${clean(String(value))}`
  }).filter((line) => line !== '- ').join('\n')
}

function fallback(key) {
  if (key === 'TENANT_ID' || key === 'TENANT_NAME') return tenantId
  return `[missing: ${key}]`
}

const blueprint = readBlueprint(blueprintPath)
const soul = blueprint.soul_draft && typeof blueprint.soul_draft === 'object' ? blueprint.soul_draft : {}
const values = {
  TENANT_ID: tenantId,
  TENANT_NAME: clean(blueprint.tenant_name || blueprint.customer_name || tenantId),
  ROLE: clean(soul.role),
  DELIVERY_MODE: clean(blueprint.delivery_mode),
  AGENT_NAME: clean(soul.name),
  TONE: clean(soul.tone),
  FORBIDDEN_RULES: list(soul.forbidden || blueprint.boundary_draft),
  BOUNDARY_RULES: list(blueprint.boundary_draft),
  UAT_CRITERIA: list(blueprint.uat_criteria),
  SKILL_LIST: list(blueprint.skills_blueprint || blueprint.skill_candidates),
  GENERATED_AT: new Date().toISOString(),
}

const processableExtensions = new Set(['.md', '.json', '.yaml', '.yml', '.txt'])

function interpolate(content) {
  return content.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (_match, key) => {
    const value = values[key]
    return value ? value : fallback(key)
  })
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(entryPath)
      continue
    }
    if (!entry.isFile() || !processableExtensions.has(path.extname(entry.name))) continue
    const original = fs.readFileSync(entryPath, 'utf8')
    const rendered = interpolate(original)
    if (rendered !== original) fs.writeFileSync(entryPath, rendered, 'utf8')
  }
}

walk(vaultRoot)
NODE
fi

mkdir -p "$OBSIDIAN_ROOT"
if [ -L "$OBSIDIAN_VIEW" ]; then
  CURRENT_TARGET="$(readlink "$OBSIDIAN_VIEW")"
  if [ "$CURRENT_TARGET" != "$VAULT_ROOT" ]; then
    echo "obsidian view already points elsewhere: $OBSIDIAN_VIEW -> $CURRENT_TARGET" >&2
    exit 1
  fi
elif [ -e "$OBSIDIAN_VIEW" ]; then
  echo "obsidian view exists and is not a symlink: $OBSIDIAN_VIEW" >&2
  exit 1
else
  ln -s "$VAULT_ROOT" "$OBSIDIAN_VIEW"
fi

echo "tenant=$TENANT_ID"
echo "vault_source=$VAULT_ROOT"
echo "obsidian_view=$OBSIDIAN_VIEW"
echo "blueprint=${BLUEPRINT_PATH:-none}"
echo "container=tenant-$TENANT_ID"
