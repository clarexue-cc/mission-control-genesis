#!/usr/bin/env bash
set -euo pipefail

VAULT_ROOT="${OBSIDIAN_VAULT_ROOT:-${MC_OBSIDIAN_VAULT_ROOT:-/Users/clare/Desktop/obsidian/openclaw}}"
INTERVAL_SECONDS="${HERMES_DAEMON_INTERVAL_SECONDS:-7200}"
STALE_SECONDS="${HERMES_STALE_SECONDS:-21600}"
PID_FILE="${HERMES_DAEMON_PID_FILE:-$VAULT_ROOT/Agent-Shared/hermes-daemon.pid}"
LOG_FILE="${HERMES_LOG_FILE:-$VAULT_ROOT/Agent-Shared/hermes-log.md}"
RUNTIME_LOG="${HERMES_RUNTIME_LOG:-$VAULT_ROOT/Agent-Shared/hermes-daemon.runtime.log}"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

mtime_epoch() {
  if stat -f %m "$1" >/dev/null 2>&1; then
    stat -f %m "$1"
  else
    stat -c %Y "$1"
  fi
}

ensure_log() {
  mkdir -p "$(dirname "$LOG_FILE")"
  if [ ! -f "$LOG_FILE" ]; then
    {
      echo "# Hermes Guard Log"
      echo
    } > "$LOG_FILE"
  fi
}

append_log() {
  ensure_log
  printf '%s\n' "$1" >> "$LOG_FILE"
}

scan_once() {
  ensure_log
  local now
  now="$(date +%s)"
  append_log "## $(timestamp) first heartbeat"

  local found=0
  shopt -s nullglob
  for agent_dir in "$VAULT_ROOT"/Agent-*; do
    [ -d "$agent_dir" ] || continue
    local agent_name
    agent_name="$(basename "$agent_dir")"
    case "$agent_name" in
      Agent-Shared|Agent-TEMPLATE) continue ;;
    esac
    found=1

    local context_file="$agent_dir/working-context.md"
    if [ ! -f "$context_file" ]; then
      append_log "- $(timestamp) | $agent_name | ALERT | 卡死告警: missing working-context.md"
      continue
    fi

    local modified age
    modified="$(mtime_epoch "$context_file")"
    age=$((now - modified))
    if [ "$age" -gt "$STALE_SECONDS" ]; then
      append_log "- $(timestamp) | $agent_name | ALERT | 卡死告警: working-context.md ${age}s 未更新，超过 ${STALE_SECONDS}s 阈值"
    else
      append_log "- $(timestamp) | $agent_name | OK | heartbeat_age=${age}s"
    fi
  done
  shopt -u nullglob

  if [ "$found" -eq 0 ]; then
    append_log "- $(timestamp) | Hermes | ALERT | 卡死告警: no Agent-* directories found under $VAULT_ROOT"
  fi
}

is_running() {
  if [ ! -f "$PID_FILE" ]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

start_daemon() {
  mkdir -p "$(dirname "$PID_FILE")"
  if is_running; then
    echo "Hermes daemon already running with pid $(cat "$PID_FILE")"
    exit 0
  fi
  nohup "$0" run >> "$RUNTIME_LOG" 2>&1 &
  echo "$!" > "$PID_FILE"
  echo "Hermes daemon started with pid $!"
}

stop_daemon() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "Hermes daemon is not running"
    exit 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" >/dev/null 2>&1 || true
  rm -f "$PID_FILE"
  append_log "- $(timestamp) | Hermes | STOPPED | daemon stopped"
  echo "Hermes daemon stopped"
}

case "${1:-check}" in
  start)
    start_daemon
    ;;
  stop)
    stop_daemon
    ;;
  status)
    if is_running; then
      echo "running $(cat "$PID_FILE")"
    else
      echo "stopped"
    fi
    ;;
  check|once)
    scan_once
    ;;
  run)
    trap 'rm -f "$PID_FILE"; append_log "- $(timestamp) | Hermes | STOPPED | daemon exited"' EXIT
    scan_once
    while true; do
      sleep "$INTERVAL_SECONDS"
      scan_once
    done
    ;;
  *)
    echo "usage: $0 {start|stop|status|check|run}" >&2
    exit 2
    ;;
esac
