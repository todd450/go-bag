# Go Bag (go-bag)

Photograph what is in your emergency kits and see how ready your household is: scores sized to
who lives with you, where you live, and the emergencies you care about most, plus a shopping
list and a family plan that close the gaps. For now it serves one family, the founder's, at
https://go-bag.vercel.app behind a sign-in. *(Drafted from the founder's requests; the founder
rewrites it.)*

Built by the Founding Agents team with one founder. This file is a short map, not a rulebook: a
rule that must hold becomes a test in `check.sh`, a lint rule or a hook, and its evidence goes in
`docs/`.

- **Checks:** `./check.sh` runs every check, and CI runs it on each pull request: the page's
  script parses, then `node --test tests/*.test.js`. Tests load the page's script into a Node
  context with a stand-in DOM (`tests/load.js`) and call its functions directly, so they need no
  browser and no claude.ai. Reach for a standard validator, linter or browser test before writing
  a check by hand. A Stop hook (`.claude/hooks/check-on-stop.sh`) also runs it when a session
  ends its turn with the page, tests or fixtures changed, and hands any failure back to fix.
- **Decisions:** an issue labelled `needs-founder` waits on the founder, and `decided` is their
  yes. Technical one-way doors (a framework or none, a build step, how it deploys, its stack, how
  it stores data, a dependency that ships, an outside service) are the founder's; each is
  recorded in the issue that decided it. Never settle one in code.
- **Edge cases:** the visible scenarios are in `fixtures/`, one folder per failure class, and
  `tests/edge.test.js` renders every tab for each one. The standard household for ordinary tests
  is `tests/household.json`.
- **Shipping:** changes reach `main` only through a pull request. Merging to `main` deploys to
  production: yes. Vercel builds every push to `main` and makes it production at
  https://go-bag.vercel.app, so the founder merges: the integrator readies each PR (up to date,
  checks green, Vercel preview built) and hands it to them. The `ship` skill
  (`.claude/skills/ship/`) is the step-by-step, and `live-commit.sh` there tells which commit is
  live. The old claude.ai Artifact (https://claude.ai/artifact/DXn8SMGiZhuKuQFGgKHenz) is retired
  (issue #48, 5 Nov 2026): it points to Vercel, and its data is a frozen copy. Never publish the
  app to it or write to its data.
- **How it runs on Vercel (issue #48):** signed in with Supabase magic links. `web/runtime.js`
  stands in for `window.claude` (db, assets, sample, user) on Supabase project `go-bag`
  (`jltxxtjlnzpxdozxovmz`) and the functions in `api/`; `tools/build-web.js` wraps the page with it
  into `dist/` (`npm run build`, Vercel's only build step). The page file is never edited for
  Vercel. Schema and policies are in `supabase/migrations/`; who may sign in is the
  `allowed_emails` table. `tests/web-runtime.test.js` covers it.
  - **Keys are in Doppler**, project `go-bag`, and set or rotated nowhere else: `dev` for this
    machine (`doppler run -- npm run build`, from `doppler.yaml`), `prd` for Vercel production
    through Doppler's Vercel integration. `ANTHROPIC_API_KEY` is in `prd` only and the founder
    sets it. Never put a key in Vercel's settings, a `.env` file or the repo. `check.sh` and the
    tests need no keys, so never wrap them in `doppler run`.
- **Local preview:** `sh preview.sh`, which serves the page at http://127.0.0.1:8765/ wrapped the
  way claude.ai wraps it. Outside claude.ai there is no `window.claude`, so nothing saves and the
  Claude features (photo scan, hazard check, review) are off. It serves a temporary copy of the
  page only, never this folder. `sh preview.sh tests/household` (or any fixture) starts it with
  that made-up household loaded from memory (`tools/fixture-db.js`); edits there are never saved.
- **Screenshots in every PR that changes the page:** run
  `node tools/screenshots.js <scratch dir>`. It shoots every tab at phone (390) and desktop (1440)
  width, from `origin/main` and from your change, with `tests/household` loaded. It takes about
  20 seconds and needs Chrome. Look at every shot it lists as changed, and say in the PR which tabs
  changed and how. Send the founder its `compare.html` (both versions side by side, in one file).
  Never commit the shots: they are scratch.
- **This product's own rules:**
  - The whole app is `emergency-kit-audit.html`: markup, one inline `<script>` and its styles,
    with no build step (`check.sh` fails on a second `<script>`). Builders working at the same
    time will touch the same file, so run `build` on one issue at a time until the founder
    decides whether to split it.
  - The page is written to claude.ai's Artifact runtime contract 0.2.96 (`window.claude` with
    `db`, `sample`, `assets` and `user`), which `web/runtime.js` provides on Vercel. Data lives in
    Supabase, not in this repo: collections `kits` and `items`, and the `household` docs
    `profile`, `hazards`, `review`, `shopping` and `plan`, all rows of the `docs` table; photos
    are in the private `photos` bucket.
    Every capability may be missing (`claude.use()` resolves `null`), and the page must still work
    in memory, which is how the tests and the preview run it.
  - No real household's data goes in this repo or a test: fixtures use made-up people. Never
    write to the founder's live household data from a session without their yes for that change.
  - The score is a weighted average of emergencies, weight = likelihood × severity × importance
    (`LEVELS`, `SEVERITY`, `IMPORTANCE`). Severity is fixed per emergency (how bad it is to face
    unprepared) and is never re-rated by the household or the location check. Next steps, "Add the top 5" and the shopping list all price a
    gap with `scoreIfShopped`, so the points shown are the points ticking adds
    (`tests/shopping.test.js`).
  - Health and everyday emergencies are rated from who lives here, never by the location check
    (`tests/health.test.js`), and a location re-check keeps the household's own levels and
    importance (`tests/scoring.test.js`).
  - The weight and space panel scores every pack it suggests with `kitReadiness` on that set
    of items, so its points are the points the kit would really score. Saved `grams`/`ml`
    always win over estimates (`tests/pack.test.js`).
  - Documents & cash, Fire safety, Comms, Tools and Medications score by named essentials
    (`ESSENTIALS`): one of each counts, an untagged item counts nothing until it is tagged, and each
    missing essential is its own gap and shopping line (`tests/essentials.test.js`).
  - An item links to Amazon: its saved `amazonUrl` (only a plain `https://www.amazon.com/dp/…`
    link counts) or else the `shopQuery` Claude writes while reading the photo. The page never
    searches Amazon itself: Amazon refuses AI agents, so exact product pages are found from a
    Claude session and saved to the item (`tests/amazon.test.js`).
