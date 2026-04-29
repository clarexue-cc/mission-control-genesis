#!/usr/bin/env bash
set -euo pipefail

TENANT_ID="${1:-}"
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
if [ ! -d "$VAULT_ROOT" ]; then
  cp -R "$TEMPLATE_ROOT" "$VAULT_ROOT"
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
echo "container=tenant-$TENANT_ID"
