#!/bin/sh
# Every check go-bag has, in one command. CI runs it on each pull request, and branch protection
# requires it to pass. Needs Node 22 or later and nothing else: no install step.
set -e
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The whole app is one page with one inline script, which Vercel serves as built by tools/build-web.js.
[ "$(grep -c '<script' emergency-kit-audit.html)" = 1 ] || { echo "check: the page must have exactly one <script>"; exit 1; }
awk '/<script>/{f=1;next}/<\/script>/{f=0}f' emergency-kit-audit.html > "$tmp/app.js"
node --check "$tmp/app.js"

# The script runs in four sections: core, prompts, views, actions (issue #112). The core (data tables, the household
# model, scoring, shopping, packing) sits between its "core begins" and "core ends" comments, and never touches the
# page, the screen's state S or markup, so it can become a file of its own (#113). tests/core.test.js runs it alone.
awk '/core begins ---/{f=1} f; /core ends ---/{f=0}' "$tmp/app.js" > "$tmp/core.js"
grep -q 'core ends ---' "$tmp/core.js" || { echo "check: the page's script needs its \"core begins\" and \"core ends\" comments"; exit 1; }
# (`document` as code: not the word in a sentence, such as "a waterproof document pouch".)
if grep -nE '(^|[^A-Za-z0-9_$])(document($|[^A-Za-z0-9_$ ]| +[^A-Za-z ])|S(\?\.|\.|\[))|</?[A-Za-z][A-Za-z0-9-]*( [^<>]*)?/?>' "$tmp/core.js"; then
  echo "check: the core section mentions document, S or an HTML tag (lines above, counted from its start). Move screen code to the views and saving to the actions."; exit 1
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
# measured 83,513 bytes with #121's Review sheet, against main's 82,975.
budget=85000
size=$(gzip -9c emergency-kit-audit.html | wc -c | tr -d ' ')
echo "check: page is $size bytes gzipped, budget $budget"
[ "$size" -le "$budget" ] || { echo "check: the page is over its size budget by $((size - budget)) bytes gzipped. Make it smaller, or raise the budget in check.sh in its own line and say why in the PR."; exit 1; }

# Behaviour: scoring, sizing, shopping, health, car kits and every tab rendering, on the fixtures.
node --test tests/*.test.js
