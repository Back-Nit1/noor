#!/usr/bin/env bash
# Overnight agent loop. Each pass is a fresh Claude session that reads
# overnight-task.md, does ONE item, verifies, commits, pushes, and exits.
# The loop restarts it — that is what produces a stream of commits.
#
#   ./scripts/overnight.sh              # run until the task list is done
#   MAX_CYCLES=5 ./scripts/overnight.sh # stop after 5 cycles (use this to test first)
#
# Stop it any time with Ctrl-C. Progress is in git log and overnight.log.

set -uo pipefail
cd "$(dirname "$0")/.."

BRANCH="Nitu"
MAX_CYCLES="${MAX_CYCLES:-100}"
PAUSE="${PAUSE:-30}"
LOG="overnight.log"

# Refuse to start anywhere but the working branch.
current="$(git rev-parse --abbrev-ref HEAD)"
if [ "$(printf '%s' "$current" | tr 'A-Z' 'a-z')" != "$(printf '%s' "$BRANCH" | tr 'A-Z' 'a-z')" ]; then
  echo "Refusing to start: HEAD is on '$current', not '$BRANCH'." >&2
  exit 1
fi

# Refuse to start on a red build — otherwise every cycle burns tokens on a pre-existing failure.
echo "Checking the build before starting..."
if ! pnpm build >/dev/null 2>&1; then
  echo "Refusing to start: 'pnpm build' is already failing. Fix it first." >&2
  exit 1
fi
echo "Build is green. Starting."

start_commit="$(git rev-parse HEAD)"

for i in $(seq 1 "$MAX_CYCLES"); do
  echo "=== cycle $i/$MAX_CYCLES — $(date '+%Y-%m-%d %H:%M:%S') ===" | tee -a "$LOG"

  claude -p "Read overnight-task.md and do the FIRST unchecked item that is not already done.

Check 'git log --oneline -30' first to see what previous cycles finished — never redo an item.

Do exactly ONE item, then stop. After making the change:
  1. Run 'pnpm build'. If it fails, fix it. Never commit a red build.
  2. Confirm 'git status' shows HEAD on $BRANCH with no unresolved conflicts.
  3. Read 'git diff --cached'. Unstage anything key-shaped.
  4. Commit only the files you changed, with a real message naming the item.
  5. Tick the item's checkbox in overnight-task.md and include that in the commit.
  6. git push origin $BRANCH

If every item is done, reply exactly: ALL_TASKS_COMPLETE
If the item needs a human decision, skip it, say why, and move to the next one.
Do not refactor anything not required by the item." \
    --permission-mode acceptEdits 2>&1 | tee -a "$LOG" | tail -20

  if tail -50 "$LOG" | grep -q "ALL_TASKS_COMPLETE"; then
    echo "All tasks complete. Stopping after $i cycles." | tee -a "$LOG"
    break
  fi

  sleep "$PAUSE"
done

echo "=== finished $(date '+%Y-%m-%d %H:%M:%S') ===" | tee -a "$LOG"
echo "Commits this run:" | tee -a "$LOG"
git log --oneline "$start_commit"..HEAD | tee -a "$LOG"
