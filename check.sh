#!/bin/sh
# Every check go-bag has, in one command. CI runs it on each pull request, and branch protection
# requires it to pass. Needs Node 22 or later and nothing else: no install step.
set -e
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The whole app is two files: the page with one inline script, and core.js, the core's one script, which
# tools/page.js and tools/build-web.js load ahead of it (issue #113). Vercel serves them as built by tools/build-web.js.
[ "$(grep -c '<script' emergency-kit-audit.html)" = 1 ] || { echo "check: the page must have exactly one <script>, its own; the core's is core.js"; exit 1; }
if grep -n '<script' core.js; then echo "check: core.js is plain script, with no <script> of its own"; exit 1; fi
awk '/<script>/{f=1;next}/<\/script>/{f=0}f' emergency-kit-audit.html > "$tmp/app.js"
node --check "$tmp/app.js"
node --check core.js

# The script runs in four sections: core, prompts, views, actions (issue #112). The core (data tables, the household
# model, scoring, shopping, packing) is core.js (#113), and never touches the page, the screen's state S or markup,
# so it runs in the browser and in Node alike. tests/core.test.js runs it alone.
# (`document` as code: not the word in a sentence, such as "a waterproof document pouch".)
if grep -nE '(^|[^A-Za-z0-9_$])(document($|[^A-Za-z0-9_$ ]| +[^A-Za-z ])|S(\?\.|\.|\[))|</?[A-Za-z][A-Za-z0-9-]*( [^<>]*)?/?>' core.js; then
  echo "check: core.js mentions document, S or an HTML tag (lines above). Move screen code to the page's views and saving to its actions."; exit 1
fi

# The Vercel version (issue #48): the runtime that stands in for window.claude, its build, and its
# functions parse. Their behaviour is in tests/web-runtime.test.js.
for f in web/runtime.js tools/build-web.js api/*.mjs; do node --check "$f"; done

# Size budget for the page, gzipped, the way it travels to the founder's phone. Set on 4 Nov 2026
# at about 20% over the 59.5 KB it was then (issue #25), so a few features fit before anyone
# has to choose. Raising it is fine when it is a choice: change this one number in a PR and say why.
# Raised to 72,000 on 4 Nov 2026 by the founder's choice, for the named essentials work (#29):
# the Essential picker (#39) took the page to about 70.4 KB.
# Raised to 76,000 on 4 Nov 2026 by the founder's choice, for the flat-lay and bag-fill work (#59).
# Raised to 77,000 on 5 Nov 2026 by the founder's choice (#64): the filled bag took the page to about
# 76.4 KB, with no dead code left in scope to remove.
# CI's Linux gzip and macOS gzip differ for the same page by up to about 1%, either way (CI read 29 bytes
# less on 5 Nov 2026): CI's number counts.
# Raised to 80,000 on 5 Nov 2026 for item pictures on the flat-lay tiles: the cutout (keyOut, cutThumb) and
# "Add item pictures" took the page to about 79.3 KB. Waiting on the founder's yes in the PR.
# Raised to 83,000 on 6 Nov 2026 by the founder's choice (#96), for each kit's real container: the container card and its editor, the bag's empty weight and the box outline.
# Raised to 85,000 for #115 step 2: Review, the plan bar and ghost tiles; the founder raised it on 10 Nov 2026. The page
# measured 83,764 bytes with #121's Review sheet (macOS gzip -9), against main's 82,975.
# Raised to 90,000 on 10 Nov 2026 by the founder's choice (#133), for the one Household tab (Household and Plan as one,
# edited in place): it took the page to about 89.0 KB, against main's 84,612.
# Raised to 94,000 on 11 Nov 2026 for what it costs (#138), which the founder asked to have built: spend and what's
# left per kit and per emergency, and Paid $ on items, took the page to about 92.1 KB against main's 89,619.
# Since #113 the app travels as two files, the page and core.js, each gzipped on its own: the budget covers both.
# The split cost about 1.5 KB, since each file compresses alone (92,330 as one page; 65,294 + 28,602 as two).
budget=94000
page=$(gzip -9c emergency-kit-audit.html | wc -c | tr -d ' ')
core=$(gzip -9c core.js | wc -c | tr -d ' ')
size=$((page + core))
echo "check: page and core.js are $size bytes gzipped ($page + $core), budget $budget"
[ "$size" -le "$budget" ] || { echo "check: the page and core.js are over their size budget by $((size - budget)) bytes gzipped. Make them smaller, or raise the budget in check.sh in its own line and say why in the PR."; exit 1; }

# Behaviour: scoring, sizing, shopping, health, car kits and every tab rendering, on the fixtures.
node --test tests/*.test.js
