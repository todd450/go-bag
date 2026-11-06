# Go Bag

Photograph what is in your emergency kits and see how ready your household is. Scores are sized
to who lives with you, where you live and the emergencies that matter most to you, and the app
turns the gaps into a shopping list and a family plan.

The app is one page, `emergency-kit-audit.html`, published as a private claude.ai Artifact. It
uses the Artifact runtime for its database and for Claude (reading kit photos, rating local
hazards, reviewing the plan), and works in memory without them.

- `./check.sh` runs every check (Node 22 or later, nothing to install).
- `sh preview.sh` serves it locally at http://127.0.0.1:8765/.
- The same page also runs on Vercel with Supabase for data and sign-in (`web/`, `api/`,
  `supabase/`, issues #48 and #70). Its keys are in Doppler (project `go-bag`):
  `doppler run -- npm run build` builds it into `dist/`.
  - The landing page is at `/` and the app at `/app`. Signing in with an email link gives each
    account one private household of its own; the family's addresses join the family household.
  - The database's SQL tests run by hand, not in CI: `supabase start`, then `supabase test db`
    (Supabase CLI and Docker; decision D10 on #70).
  - Opening the site to strangers is one checklist, followed in order:
    [`docs/opening.md`](docs/opening.md).
- `CLAUDE.md` is the map for agent sessions, including how a change ships.
