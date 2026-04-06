#!/bin/bash

set -euo pipefail

APP_URL="${APP_URL:-http://127.0.0.1:5174}"
TEAM_NAME="Browser Smoke Team $(date +%s)"
TASK_NAME="Browser Smoke Task"

ab() {
  agent-browser "$@"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"

  if [[ "$haystack" != *"$needle"* ]]; then
    echo "Expected page text to contain: $needle" >&2
    exit 1
  fi
}

wait_for_contains() {
  local needle="$1"
  local attempts="${2:-12}"
  local delay_ms="${3:-500}"
  local text=""

  for _ in $(seq 1 "$attempts"); do
    text="$(ab get text body || true)"
    if [[ "$text" == *"$needle"* ]]; then
      printf '%s' "$text"
      return 0
    fi
    ab wait "$delay_ms" >/dev/null || true
  done

  echo "Expected page text to contain: $needle" >&2
  exit 1
}

echo "Opening $APP_URL in browser smoke session..."
ab open "$APP_URL" >/dev/null
ab wait 1000 >/dev/null || true

body_text="$(wait_for_contains "Multi-Agent Command Center")"
assert_contains "$body_text" "Observability"

if [[ "$body_text" != *"Execution posture"* ]]; then
  echo "Switching to orchestration..."
  ab click 'nav[aria-label="Primary views"] button:nth-of-type(2)' >/dev/null
  ab wait 800 >/dev/null || true
  body_text="$(wait_for_contains "Execution posture")"
fi

echo "Creating team '$TEAM_NAME'..."
ab fill 'input[placeholder="Name"]' "$TEAM_NAME" >/dev/null
ab press Enter >/dev/null
ab wait 1200 >/dev/null || true

body_text="$(wait_for_contains "$TEAM_NAME")"

echo "Filtering team list..."
ab fill 'input[placeholder="Search teams, descriptions, or IDs"]' "$TEAM_NAME" >/dev/null
ab wait 500 >/dev/null || true

body_text="$(wait_for_contains "$TEAM_NAME")"

echo "Selecting new team..."
ab click "button:has-text(\"$TEAM_NAME\")" >/dev/null
ab wait 700 >/dev/null || true

echo "Creating task '$TASK_NAME'..."
ab fill 'input[placeholder="Title"]' "$TASK_NAME" >/dev/null
ab click 'button:has-text("Enqueue task")' >/dev/null
ab wait 1000 >/dev/null || true

body_text="$(wait_for_contains "$TASK_NAME")"

if [[ "$body_text" != *"No execution record for this task yet."* ]]; then
  echo "Opening task detail..."
  ab click "button:has-text(\"$TASK_NAME\")" >/dev/null
  ab wait 700 >/dev/null || true
  body_text="$(wait_for_contains "$TASK_NAME")"
fi

assert_contains "$body_text" "Status"

ab close >/dev/null || true

echo "Browser smoke passed for $APP_URL"
