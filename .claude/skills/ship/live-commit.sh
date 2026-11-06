#!/bin/sh
# Which commit of emergency-kit-audit.html is live on Vercel? Fetches production (or reads a saved
# copy you pass), strips the wrapper tools/page.js puts around the page for tools/build-web.js (the
# <head> with the runtime's scripts, then <body>...</body></html>), and compares the page, byte for
# byte, with every version of the page on <ref>.
# Prints the matching commit and exits 0, or says nothing matches and exits 1.
#   sh .claude/skills/ship/live-commit.sh [url or saved file, default https://go-bag.vercel.app/] [ref, default origin/main]
set -e
src=${1:-https://go-bag.vercel.app/}
ref=${2:-origin/main}
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
case $src in
  http://*|https://*) curl -fsS -H 'Cache-Control: no-cache' "$src" -o "$tmp" || { echo "couldn't fetch $src" >&2; exit 2; } ;;
  *) [ -f "$src" ] || { echo "usage: $0 [url or saved file] [ref]" >&2; exit 2; }; cp "$src" "$tmp" ;;
esac
blob=$(node -e '
const s = require("fs").readFileSync(process.argv[1], "utf8");
const open = s.indexOf("</head><body>"), close = s.lastIndexOf("</body></html>");
if (!s.startsWith("<!doctype html><html><head>") || open < 0 || close < open) { console.error("not a page wrapped by tools/page.js"); process.exit(2); }
process.stdout.write(s.slice(open + "</head><body>".length, close));' "$tmp" | git hash-object --stdin)
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"  # pathspecs below are from the repo root
for c in $(git log --format=%H "$ref" -- emergency-kit-audit.html); do
  if [ "$(git rev-parse "$c:emergency-kit-audit.html")" = "$blob" ]; then echo "$c"; exit 0; fi
done
echo "no commit on $ref matches the live page" >&2
exit 1
