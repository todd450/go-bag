#!/bin/sh
# Every check go-bag has, in one command. CI runs it on each pull request, and branch protection
# requires it to pass. Needs Node 22 or later and nothing else: no install step.
set -e
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The whole app is one page with one inline script, published as a claude.ai Artifact.
[ "$(grep -c '<script' emergency-kit-audit.html)" = 1 ] || { echo "check: the page must have exactly one <script>"; exit 1; }
awk '/<script>/{f=1;next}/<\/script>/{f=0}f' emergency-kit-audit.html > "$tmp/app.js"
node --check "$tmp/app.js"

# Behaviour: scoring, sizing, shopping, health, car kits and every tab rendering, on the fixtures.
node --test tests/*.test.js
