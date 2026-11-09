#!/bin/sh
# Which commit is live on Vercel? Prints the newest commit on <ref> whose page, web/runtime.js and
# web/signin.js all match what production's /app serves, byte for byte. Exits 1 (saying which file
# doesn't match) when none does. The logic and its tests: tools/live-commit.js, tests/live-commit.test.js.
#   sh .claude/skills/ship/live-commit.sh [url, dist/ folder or saved app page; default https://go-bag.vercel.app/app] [ref, default origin/main]
exec node "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/tools/live-commit.js" "$@"
