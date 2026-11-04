#!/bin/sh
# Serves the page at http://127.0.0.1:8765/ wrapped the way claude.ai wraps it (doctype, charset,
# viewport). Outside claude.ai there is no window.claude: nothing saves, and the Claude features are off.
# Pass a fixture to start with that made-up household in it, served from memory:
#   sh preview.sh tests/household      (or fixtures/empty-and-one/big-household, ...)
# PORT changes the port.
set -e
cd "$(dirname "$0")"
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
node tools/page.js emergency-kit-audit.html "$1" > "$dir/index.html"
python3 -m http.server "${PORT:-8765}" --bind 127.0.0.1 --directory "$dir"
