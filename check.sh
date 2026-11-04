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

# Size budget for the page, gzipped, the way it travels to the founder's phone. Set on 4 Nov 2026
# at about 20% over the 59.5 KB it was then (issue #25), so a few features fit before anyone
# has to choose. Raising it is fine when it is a choice: change this one number in a PR and say why.
# Raised to 72,000 on 4 Nov 2026 by the founder's choice, for the named essentials work (#29):
# the Essential picker (#39) took the page to about 70.4 KB.
budget=72000
size=$(gzip -9c emergency-kit-audit.html | wc -c | tr -d ' ')
echo "check: page is $size bytes gzipped, budget $budget"
[ "$size" -le "$budget" ] || { echo "check: the page is over its size budget by $((size - budget)) bytes gzipped. Make it smaller, or raise the budget in check.sh in its own line and say why in the PR."; exit 1; }

# Behaviour: scoring, sizing, shopping, health, car kits and every tab rendering, on the fixtures.
node --test tests/*.test.js
