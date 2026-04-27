#!/usr/bin/env bash
set -euo pipefail

VAULT_ROOT="${OBSIDIAN_VAULT_ROOT:-${MC_OBSIDIAN_VAULT_ROOT:-/Users/clare/Desktop/obsidian/openclaw}}"
AGENT_DIR="${1:-Agent-Main}"
NOTE="${2:-agent heartbeat}"

case "$AGENT_DIR" in
  Agent-*) ;;
  *) AGENT_DIR="Agent-$AGENT_DIR" ;;
esac

CONTEXT_DIR="$VAULT_ROOT/$AGENT_DIR"
CONTEXT_FILE="$CONTEXT_DIR/working-context.md"

mkdir -p "$CONTEXT_DIR"

cat > "$CONTEXT_FILE" <<EOF
# Working Context

- last_update: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- agent: $AGENT_DIR
- status: active
- note: $NOTE

This file is maintained by agent-heartbeat.sh so Hermes can detect stalled agents.
EOF

echo "$CONTEXT_FILE"
