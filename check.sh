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

# The app's size (the page and core.js), gzipped, the way it travels to the founder's phone: reported, never a failure. The size
# budget set in #25 was removed on 14 Nov 2026 by the founder's choice, after it had been raised eight times.
page=$(gzip -9c emergency-kit-audit.html | wc -c | tr -d ' ')
core=$(gzip -9c core.js | wc -c | tr -d ' ')
echo "check: page and core.js are $((page + core)) bytes gzipped ($page + $core)"

# Behaviour: scoring, sizing, shopping, health, car kits and every tab rendering, on the fixtures.
node --test tests/*.test.js
