#!/usr/bin/env bash
# PreToolUse hook for Edit|Write|MultiEdit|NotebookEdit.
# Exit 2 = block the action and show the message to Claude. Exit 0 = allow.
# Fail-closed: if we cannot determine the target path, we block.

set -uo pipefail

input="$(cat)"

deny() {
  echo "BLOCKED by .claude/hooks/protect-files.sh: $1" >&2
  exit 2
}

command -v jq >/dev/null 2>&1 || deny "jq is not installed; cannot validate file writes."

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')"

# Some tools carry no path (rare). Nothing to protect -> allow.
[ -z "$file_path" ] && exit 0

# Normalize to a repo-relative-ish comparison string.
case "$file_path" in
  /*) abs="$file_path" ;;
  *)  abs="${CLAUDE_PROJECT_DIR:-$PWD}/$file_path" ;;
esac

# Explicitly safe files that would otherwise match a protected pattern.
# .env.example / .env.sample carry variable NAMES only, never values.
case "$(basename "$abs")" in
  .env.example|.env.sample|.env.template) exit 0 ;;
esac

# Protected path patterns. Case-insensitive match against the absolute path.
protected=(
  "*/.env"
  "*/.env.*"
  "*/.git/*"
  "*/.medplum/*"
  "*/medplum/.env"
  "*/.datasets/*"
  "*/secrets/*"
  "*credential*"
  "*/id_rsa*"
  "*.pem"
  "*.p12"
  "*.keystore"
  "*/.claude/settings.json"
  "*/.claude/hooks/*"
  "*/.ssh/*"
  "*/.aws/*"
  "*/pnpm-lock.yaml"
)

shopt -s nocasematch
for pat in "${protected[@]}"; do
  if [[ "$abs" == $pat ]]; then
    deny "'$file_path' is a protected file (secrets, git internals, lockfile, or the guardrail config itself). A human must edit this outside Claude."
  fi
done
shopt -u nocasematch

# Never let an agent write outside the project directory.
proj="${CLAUDE_PROJECT_DIR:-$PWD}"
if [[ "$abs" != "$proj"/* ]]; then
  deny "'$file_path' is outside the project directory ($proj). Writes are confined to the repo."
fi

# Scan new content for hardcoded secrets before it ever lands on disk.
content="$(printf '%s' "$input" | jq -r '
  [ .tool_input.content?,
    .tool_input.new_string?,
    (.tool_input.edits? // [] | .[]?.new_string),
    .tool_input.new_source?
  ] | map(select(. != null)) | join("\n")')"

if [ -n "$content" ]; then
  # Real key shapes only; keeps false positives low.
  secret_res=(
    'sk-ant-[A-Za-z0-9_-]{16,}'
    'sk-[A-Za-z0-9]{32,}'
    'AKIA[0-9A-Z]{16}'
    'ghp_[A-Za-z0-9]{30,}'
    'gh[pousr]_[A-Za-z0-9]{30,}'
    'xox[baprs]-[A-Za-z0-9-]{10,}'
    'AIza[0-9A-Za-z_-]{30,}'
    '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'
  )
  for re in "${secret_res[@]}"; do
    if printf '%s' "$content" | grep -Eq -e "$re"; then
      deny "The content you are writing to '$file_path' contains what looks like a real API key or private key. Use process.env.<NAME> and document the variable in .env.example instead."
    fi
  done
fi

exit 0
