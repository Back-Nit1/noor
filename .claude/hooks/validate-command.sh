#!/usr/bin/env bash
# PreToolUse hook for Bash.
# Exit 2 = block and explain to Claude. Exit 0 = allow.
# Fail-closed: unparseable input is blocked.
#
# Enforces, in order:
#   1. No destructive filesystem/git commands
#   2. No shell-level writes to protected files (the bash fallback around protect-files.sh)
#   3. No piping remote content into a shell
#   4. No destructive SQL
#   5. BRANCH LOCK: commits/pushes only ever land on Nitu
#   6. No committing while merge conflicts are unresolved

set -uo pipefail

ALLOWED_BRANCH="Nitu"

input="$(cat)"

deny() {
  echo "BLOCKED by .claude/hooks/validate-command.sh: $1" >&2
  exit 2
}

command -v jq >/dev/null 2>&1 || deny "jq is not installed; cannot validate bash commands."

cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
[ -z "$cmd" ] && exit 0

# ---------- 1. destructive filesystem / history ----------
declare -a destructive=(
  'rm[[:space:]]+(-[a-zA-Z]*[[:space:]]+)*-?[a-zA-Z]*[rR][a-zA-Z]*f|rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*[rR]'
  ':\(\)\{.*\|.*&.*\};:'
  'mkfs|dd[[:space:]]+if=.*of=/dev/'
  'chmod[[:space:]]+-R[[:space:]]+777[[:space:]]+/'
  '>[[:space:]]*/dev/sd'
)
for re in "${destructive[@]}"; do
  printf '%s' "$cmd" | grep -Eq "$re" && \
    deny "'$cmd' is a destructive filesystem command. Overnight agents may not delete or reformat anything."
done

declare -a git_destructive=(
  'git[[:space:]]+push[[:space:]].*(--force([^-]|$)|-f([[:space:]]|$))'
  'git[[:space:]]+reset[[:space:]]+--hard'
  'git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*[dfx]'
  'git[[:space:]]+filter-branch'
  'git[[:space:]]+update-ref[[:space:]]+-d'
  'git[[:space:]]+branch[[:space:]]+(-D|-d|--delete)'
  'git[[:space:]]+push[[:space:]].*--delete'
  'git[[:space:]]+reflog[[:space:]]+(expire|delete)'
  'gh[[:space:]]+(pr[[:space:]]+merge|repo[[:space:]]+delete|secret)'
)
for re in "${git_destructive[@]}"; do
  printf '%s' "$cmd" | grep -Eq "$re" && \
    deny "'$cmd' rewrites or destroys git history. Only additive commits are permitted. A human handles force-pushes, merges, resets and PR merges."
done

# ---------- 2. shell-level writes to protected files ----------
# This is the fallback that bypasses protect-files.sh entirely.
# .env.example / .env.sample hold variable NAMES only and are safe to read and write.
# Strip those exact tokens before secret-path matching so they don't trip the '\.env' rule,
# while any OTHER .env reference in the same command still gets caught.
scan_cmd="$(printf '%s' "$cmd" | sed -E 's/\.env\.(example|sample|template)//g')"

declare -a protected_targets=(
  '\.env'
  '\.medplum/'
  '\.datasets/'
  'secrets/'
  'credential'
  'id_rsa'
  '\.pem'
  '\.claude/settings\.json'
  '\.claude/hooks/'
  '\.ssh/'
  '\.aws/'
)
for target in "${protected_targets[@]}"; do
  # redirection into, or in-place edit of, a protected path
  if printf '%s' "$scan_cmd" | grep -Eq ">>?[[:space:]]*[^|;&]*${target}"; then
    deny "This command redirects shell output into a protected file matching '${target}'. Secrets and guardrail config are edited by humans only."
  fi
  if printf '%s' "$scan_cmd" | grep -Eq "(sed[[:space:]]+-i|tee|truncate|dd|cp|mv|install)[^|;&]*${target}"; then
    deny "This command writes to or overwrites a protected file matching '${target}'. Secrets and guardrail config are edited by humans only."
  fi
  # reading secrets into the transcript is itself the leak
  if printf '%s' "$scan_cmd" | grep -Eq "(cat|less|more|head|tail|bat|xxd|strings|od|grep|rg|awk|sed|open|code)[^|;&]*${target}"; then
    deny "This command reads a protected file matching '${target}'. Anything read enters the conversation transcript — that IS the leak. Read .env.example instead to learn variable names."
  fi
done

# ---------- 3. pipe remote content into a shell ----------
if printf '%s' "$cmd" | grep -Eq '(curl|wget|fetch)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(bash|zsh|ksh|sh)([[:space:]]|$)'; then
  deny "Piping downloaded content into a shell executes untrusted remote code. Never do this."
fi
if printf '%s' "$cmd" | grep -Eq '^[[:space:]]*(sudo|curl|wget)([[:space:]]|$)'; then
  deny "'${cmd%% *}' is not permitted for background agents (privilege escalation / network exfiltration). Use WebFetch for reading a URL."
fi

# ---------- 4. destructive SQL ----------
if printf '%s' "$cmd" | grep -Eiq '(drop[[:space:]]+(table|database|schema)|truncate[[:space:]]+table|delete[[:space:]]+from[[:space:]]+[a-z_]+[[:space:]]*(;|$))'; then
  deny "Destructive SQL (DROP / TRUNCATE / unqualified DELETE) is blocked. Schema and data changes require a human."
fi

# ---------- 5. BRANCH LOCK ----------
is_git_write=false
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+(commit|push|cherry-pick|revert|am|apply)' && is_git_write=true

# Block switching off the working branch at all.
if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+(checkout|switch)[[:space:]]'; then
  # allow file-restore forms: git checkout -- <path>
  if ! printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+checkout[[:space:]]+--[[:space:]]'; then
    target="$(printf '%s' "$cmd" | sed -E 's/.*git[[:space:]]+(checkout|switch)[[:space:]]+(-[a-zA-Z-]+[[:space:]]+)*//' | awk '{print $1}')"
    if [ -n "$target" ] && [ "$(printf '%s' "$target" | tr 'A-Z' 'a-z')" != "$(printf '%s' "$ALLOWED_BRANCH" | tr 'A-Z' 'a-z')" ]; then
      deny "Branch lock: agents may not switch off '$ALLOWED_BRANCH' (attempted: '$target'). All overnight work stays on '$ALLOWED_BRANCH'."
    fi
  fi
fi

if [ "$is_git_write" = true ]; then
  current="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ -z "$current" ]; then
    deny "Could not determine the current git branch. Refusing to write to git (fail-closed)."
  fi
  # macOS git is case-insensitive on refs; compare case-insensitively.
  if [ "$(printf '%s' "$current" | tr 'A-Z' 'a-z')" != "$(printf '%s' "$ALLOWED_BRANCH" | tr 'A-Z' 'a-z')" ]; then
    deny "Branch lock: HEAD is on '$current', not '$ALLOWED_BRANCH'. Run 'git checkout $ALLOWED_BRANCH' first. Agents commit ONLY to '$ALLOWED_BRANCH'."
  fi

  # ---------- 6. no committing over unresolved conflicts ----------
  if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+commit'; then
    if git -C "${CLAUDE_PROJECT_DIR:-$PWD}" ls-files --unmerged | grep -q .; then
      deny "There are unresolved merge conflicts in the working tree. Resolve them (or stop and leave them for a human) before committing. Committing conflict markers overnight is worse than committing nothing."
    fi
    if git -C "${CLAUDE_PROJECT_DIR:-$PWD}" diff --cached -U0 2>/dev/null | grep -Eq '^\+(<{7}|={7}|>{7})([[:space:]]|$)'; then
      deny "The staged diff contains merge conflict markers (<<<<<<< / ======= / >>>>>>>). Clean these up before committing."
    fi
  fi
fi

# Any push must target Nitu explicitly, and never main.
if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push'; then
  if printf '%s' "$cmd" | grep -Eiq 'git[[:space:]]+push[^|;&]*[[:space:]:](main|master)([[:space:]]|$|:)'; then
    deny "Branch lock: pushing to main/master is forbidden. Push only to '$ALLOWED_BRANCH'."
  fi
fi

exit 0
