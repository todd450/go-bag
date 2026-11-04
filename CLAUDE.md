# Emergency Kit Audit (go-bag)

Photograph what is in your emergency kits and see how ready your household is: scores sized to
who lives with you, where you live, and the emergencies you care about most, plus a shopping
list and a family plan that close the gaps. For now it serves one family, the founder's, as a
private page on claude.ai. *(Drafted from the founder's requests; the founder rewrites it.)*

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
  production: no. The integrator merges. Production is the private claude.ai Artifact
  https://claude.ai/artifact/DXn8SMGiZhuKuQFGgKHenz, published from `emergency-kit-audit.html`
  on `main` with the Artifact tool: pass `url` set to that link and leave out `capabilities` and
  `icon`, so the stored ones carry forward. Publish only from a green `main`, and only when the
  founder asks. The `ship` skill (`.claude/skills/ship/`) is the step-by-step for landing PRs and
  publishing, and `live-commit.sh` there tells which commit is live.
- **Local preview:** `sh preview.sh`, which serves the page at http://127.0.0.1:8765/ wrapped the
  way claude.ai wraps it. Outside claude.ai there is no `window.claude`, so nothing saves and the
  Claude features (photo scan, hazard check, review) are off. It serves a temporary copy of the
  page only, never this folder.
- **This product's own rules:**
  - The whole app is `emergency-kit-audit.html`: markup, one inline `<script>` and its styles,
    with no build step (`check.sh` fails on a second `<script>`). Builders working at the same
    time will touch the same file, so run `build` on one issue at a time until the founder
    decides whether to split it.
  - The page runs on Artifact runtime contract 0.2.96 and declares `db`, `sample`, `assets` and
    `user`. Data lives in the Artifact's database, not in this repo: collections `kits` and
    `items`, and the `household` docs `profile`, `hazards`, `review`, `shopping` and `plan`.
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
  - An item links to Amazon: its saved `amazonUrl` (only a plain `https://www.amazon.com/dp/…`
    link counts) or else the `shopQuery` Claude writes while reading the photo. The page never
    searches Amazon itself: Amazon refuses AI agents, so exact product pages are found from a
    Claude session and saved to the item (`tests/amazon.test.js`).
