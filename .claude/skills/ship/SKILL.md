---
name: ship
description: Ready approved go-bag pull requests for the founder to merge, which deploys them to production on Vercel, and check what production is running. Use when the founder says merge, land, ship or publish, or asks whether production is up to date.
---

# Ship go-bag

Production is https://go-bag.vercel.app, the Vercel project `go-bag` (team `todd450s-projects`),
with its data in Supabase project `go-bag` (`jltxxtjlnzpxdozxovmz`). Vercel builds every push to
`main` and makes it production, so **merging to `main` is publishing**. The founder merges; no
agent or session does. The integrator readies each PR and hands it over. (Decided by the founder
on 5 Nov 2026, issue #48.)

The old claude.ai Artifact (https://claude.ai/artifact/DXn8SMGiZhuKuQFGgKHenz) is retired: it
shows a page that points to Vercel, and its database is a frozen copy as of 5 Nov 2026. Never
publish the app to it or write to its data.

## Work from commits, not the folder

Other sessions may be working in the main go-bag folder at the same time, and they can switch its
branch between two of your commands. So:

- Never switch branches in the main folder. When you need a checkout, make a worktree:
  `git worktree add .claude/worktrees/<name> -b <branch> origin/main`.
- Name commits by their full SHA from `git fetch origin && git rev-parse origin/main`.

## Ready pull requests

Ready only PRs the founder has approved: their "merge" in chat, an approving review, or the
`decided` label on the PR's issue. Ready them one at a time, oldest first, because almost every PR
edits the same `emergency-kit-audit.html`, and each merge goes live at once.

For each PR:

1. **Bring it up to date.** If `main` has moved since the branch was cut, run
   `gh pr update-branch <n>`. If that reports a conflict, resolve it in a worktree of the PR's
   branch, run `./check.sh` there, and push. Don't resolve a conflict by dropping the other side's
   change. When the right merge isn't clear, ask the founder.
2. **Wait for green.** Read the checks with `gh pr checks <n>`. Branch protection requires the
   `check` job. If the checks are still running, wait. In the desktop app a CI notification wakes
   the session; elsewhere use `gh pr checks <n> --watch`. Never merge with `--admin`.
3. **Check its Vercel preview.** Vercel builds every branch. The PR's Vercel check links its
   preview; a failed Vercel build means the merge would break production, so it isn't ready.
4. **Hand it to the founder.** Tell them it's ready, with the PR link and one line on what goes
   live when they merge it. They merge it on GitHub (squash). Wait for their merge before readying
   the next PR that touches the same files.

## After a merge: check production

1. **Pick the commit.** Run `git fetch origin`, then set `sha=$(git rev-parse origin/main)`.
2. **Check the deploy.** In Vercel (the Vercel MCP's `list_deployments` for project `go-bag`, team
   `todd450s-projects`, `target: production`), the newest production deployment must be `READY`
   with `githubCommitSha` equal to `$sha`. If it is `ERROR`, read its build logs and tell the
   founder: production still serves the previous deployment, and Vercel can roll back to any
   earlier one.
3. **Check the page.** Run `sh .claude/skills/ship/live-commit.sh`. It fetches
   https://go-bag.vercel.app/ and prints the commit whose page is live; it must print `$sha`, or
   the newest commit before `$sha` that changed the page (a merge that only touches tests or docs
   leaves the page as it was).
4. **Report back.** Tell the founder the commit, the PRs it shipped, and the deployment URL.

## The household's live data

A merge replaces only the code. The household's kits, items and plan stay in Supabase: the
`docs` table (`col` is `kits`, `items` or `household`) and the private `photos` bucket. A release
can leave saved data out of step with the new page, for example an item that now belongs in a
new category.

- Before you say anything about what's saved, read it (the Supabase MCP's `execute_sql`, select
  only). Nothing is known about the data until you've read it.
- Write to it only with the founder's yes for that specific change. Change only the fields you
  mean to (`data || jsonb_build_object(...)`, never a whole-row replace), and pin each write to the
  `updated_at` you read, so an edit made since is never overwritten.
- Photos can only be added by a signed-in member (no service key exists, by design), so new
  pictures go in through the page itself.
- Often the page offers the fix itself. For example, Next steps shows a **Move** button for
  items that need a new category. Prefer that over writing the data yourself.
