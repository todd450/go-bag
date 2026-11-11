---
name: ship
description: Ready reviewed go-bag pull requests and merge them with auto-merge, which deploys them to production on Vercel, and check what production is running. Use when a pull request has been reviewed and is ready to land, when the founder says merge, land, ship or publish, or asks whether production is up to date.
---

# Ship go-bag

Production is https://go-bag.vercel.app, the Vercel project `go-bag` (team `todd450s-projects`),
with its data in Supabase project `go-bag` (`jltxxtjlnzpxdozxovmz`). Vercel builds every push to
`main` and makes it production, so **merging to `main` is publishing**. The integrator merges,
without asking the founder: it readies each reviewed PR and turns on auto-merge, and GitHub merges
it once the required `check` passes. The team's reviewers are the review. (Decided by the founder
on 11 Nov 2026; before that, from 5 Nov 2026 and issue #48, the founder merged every PR.) A merge
that GitHub or Claude Code refuses comes back to the founder and is never worked around. A bad
deploy is undone with Vercel's Instant Rollback.

The old claude.ai Artifact (https://claude.ai/artifact/DXn8SMGiZhuKuQFGgKHenz) is retired: it
shows a page that points to Vercel (version 28, renamed for Go Bag on 6 Nov 2026), and its database is a frozen copy as of 5 Nov 2026. Never
publish the app to it or write to its data.

## Work from commits, not the folder

Other sessions may be working in the main go-bag folder at the same time, and they can switch its
branch between two of your commands. So:

- Never switch branches in the main folder. When you need a checkout, make a worktree:
  `git worktree add .claude/worktrees/<name> -b <branch> origin/main`.
- Name commits by their full SHA from `git fetch origin && git rev-parse origin/main`.

## Ready pull requests

Ready only PRs that have been reviewed: the reviewers' latest verdict comments on the PR all say
Approve (as `build` posts them), or the founder said "merge" in chat. A PR made in a chat session
has no verdicts yet, so run the reviewers on it first. Ready them one at a time, oldest first,
because almost every PR edits the same `emergency-kit-audit.html`, and each merge goes live at once.

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
4. **Turn on auto-merge.** Run `gh pr merge <n> --auto --squash`. GitHub merges the PR when the
   required `check` passes; if it is already green, it merges at once. Confirm it merged
   (`gh pr view <n> --json state`) before readying the next PR that touches the same files. If a
   check fails, fix it on the branch and push; don't merge another way.

## After a merge: check production

1. **Pick the commit.** Run `git fetch origin`, then set `sha=$(git rev-parse origin/main)`.
2. **Check the deploy.** In Vercel (the Vercel MCP's `list_deployments` for project `go-bag`, team
   `todd450s-projects`, `target: production`), the newest production deployment must be `READY`
   with `githubCommitSha` equal to `$sha`. If it is `ERROR`, read its build logs and tell the
   founder: production still serves the previous deployment, and Vercel can roll back to any
   earlier one.
3. **Check what's served.** Run `sh .claude/skills/ship/live-commit.sh`. It fetches
   https://go-bag.vercel.app/app and the `runtime.js` and `signin.js` it loads, and prints the
   newest commit whose page and both scripts all match; it must print `$sha`, or the newest commit
   before `$sha` that changed one of them (a merge that only touches tests or docs leaves them as
   they were). When nothing matches it says which file doesn't, and exits 1. The landing at `/` is
   not checked.
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
- Often the page offers the fix itself. For example, an item that needs a new category or an
  essential tag is fixed with the **Category** or **Essential** picker in its kit's item table.
  Prefer that over writing the data yourself.
