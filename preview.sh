#!/bin/sh
# Serves the page at http://127.0.0.1:8765/ wrapped the way claude.ai wraps it (doctype, charset,
# viewport). Outside claude.ai there is no window.claude: nothing saves, and the Claude features are off.
set -e
cd "$(dirname "$0")"
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
{ printf '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
  cat emergency-kit-audit.html
  printf '</body></html>\n'; } > "$dir/index.html"
python3 -m http.server 8765 --bind 127.0.0.1 --directory "$dir"
