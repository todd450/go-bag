#!/bin/sh
# Stop / SubagentStop hook: a session can't end its turn with the app's checks failing.
# If the page, core.js, tests or fixtures differ from origin/main in this checkout (worktrees included),
# run ./check.sh. On failure, exit 2 so Claude Code hands the output back and the session keeps
# working. On the second try in a row (stop_hook_active), let it stop but warn the founder,
# so a check that can't pass never traps a session in a loop. CI stays the gate on main.
input=$(cat)
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -x "$root/check.sh" ] || exit 0
git -C "$root" diff --quiet origin/main -- emergency-kit-audit.html core.js tests fixtures 2>/dev/null && exit 0
out=$("$root/check.sh" 2>&1) && exit 0
if printf '%s' "$input" | grep -q '"stop_hook_active" *: *true'; then
  echo '{"systemMessage": "check.sh is still failing in this checkout; the session stopped anyway. Run ./check.sh to see why."}'
  exit 0
fi
{
  echo "./check.sh fails in $root. Fix it before finishing (last 40 lines):"
  printf '%s\n' "$out" | tail -40
} >&2
exit 2
