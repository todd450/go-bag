#!/bin/sh
# Which commit of emergency-kit-audit.html is live? Pass the saved copy that the Artifact tool's
# `read` action wrote. This strips claude.ai's wrapper (its first line, and the closing tags it
# appends) and compares the page, byte for byte, with every version of the page on <ref>.
# Prints the matching commit and exits 0, or says nothing matches and exits 1.
#   sh .claude/skills/ship/live-commit.sh <saved-live.html> [ref, default origin/main]
set -e
live=$1
ref=${2:-origin/main}
[ -f "$live" ] || { echo "usage: $0 <saved-live.html> [ref]" >&2; exit 2; }
blob=$(node -e '
const s = require("fs").readFileSync(process.argv[1], "utf8");
const wrapped = s.startsWith("<!doctype html><html><head><meta charset=utf8>");
let body = wrapped ? s.slice(s.indexOf("\n") + 1) : s;
if (wrapped) body = body.replace(/\n<\/body><\/html>\s*$/, "");
process.stdout.write(body);' "$live" | git hash-object --stdin)
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"  # pathspecs below are from the repo root
for c in $(git log --format=%H "$ref" -- emergency-kit-audit.html); do
  if [ "$(git rev-parse "$c:emergency-kit-audit.html")" = "$blob" ]; then echo "$c"; exit 0; fi
done
echo "no commit on $ref matches the live page" >&2
exit 1
