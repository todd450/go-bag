# Emergency Kit Audit

Photograph what is in your emergency kits and see how ready your household is. Scores are sized
to who lives with you, where you live and the emergencies that matter most to you, and the app
turns the gaps into a shopping list and a family plan.

The app is one page, `emergency-kit-audit.html`, published as a private claude.ai Artifact. It
uses the Artifact runtime for its database and for Claude (reading kit photos, rating local
hazards, reviewing the plan), and works in memory without them.

- `./check.sh` runs every check (Node 22 or later, nothing to install).
- `sh preview.sh` serves it locally at http://127.0.0.1:8765/.
- `CLAUDE.md` is the map for agent sessions, including how a change ships.
