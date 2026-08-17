---
name: burn
description: Implement one tracked issue and close it on the current branch — `/to-code` then `/done`, no PR ceremony. Use when the user invokes `/burn <issue-id>`, says "implement and close #123", or wants an issue finished on a branch that already exists.
---

# Burn

One issue, implemented and closed, on the branch already checked out. `/to-code` + `/done`.

No PR, no branch creation. Need a PR opened -> `/burn --no-push` then `/pr`. Want N issues off one PR -> `/burndown` (it delegates a burn per issue).

On a branch that already has a PR, burn is the whole flow: it pushes, the PR updates itself, nothing else to run.

## Comms

Use `caveman` full style when available, else terse. Code/commands/paths/issue ids exact.

## Invocation

```text
/burn 123
/burn #123
/burn https://github.com/OWNER/REPO/issues/123
/burn 123 --no-push     # commit + close locally, leave push to caller
```

Missing id -> infer from branch name or the most recent issue fetched in this chat. Ambiguous -> ask.

## Preflight (stop on fail, ask user)

- Issue already `CLOSED` -> stop, say so. Never re-close.
- Issue labelled `needs-info` / `needs-triage` -> stop, ask. Only `ready-for-agent` (or explicit user go-ahead) is burnable.
- **Branch fit.** Compare the issue's `area:<slug>` label / `[Area]` title prefix against the current branch name:
  - `main` / `master` -> `On main. Burn here?` Wait.
  - `dev` -> `On dev, no feature branch. Burn here?` Wait.
  - Feature branch whose name does not match the issue's area -> `branch <name> vs issue area <area>. Burn here?` Wait.
  - Match, or issue has no area signal -> proceed silently.

  Yes -> burn on that branch. **Never offer or create another branch** — that is `/pr`'s job.

- Dirty tree with changes unrelated to this issue -> show `git status --short`, ask: stash / commit first / proceed-and-leave-unstaged. Never sweep them into the issue commit.
- **Never create, switch, or rename a branch.** Burn works on what is checked out.

## Step 1 — Implement

Follow `.agents/skills/to-code/SKILL.md`, sections **Read Order** + **Workflow** steps 1-5 (Understand, Plan, Implement, Verify, Report).

Skip to-code step 6 (commit) — `/done` owns the commit.

That skill's refusal triggers stay in force: no concrete expected behavior, incompatible directions, safety-sensitive board behavior, or missing hardware/creds -> stop and ask, one question at a time.

## Step 2 — Close

Follow `.agents/skills/done/SKILL.md` with the resolved issue id. It owns verification gate, scoped staging, commit message format (`<summary> #<id>`), and the close comment.

Do not re-run to-code's verification — `/done` verifies. One gate, not two.

Tests fail -> `/done` stops. Do not close, do not push. Surface and stop.

## Step 3 — Push (default on)

`/done` deliberately does not push. Burn does, unless `--no-push`:

```bash
git push origin <current-branch>
```

Rejected non-fast-forward -> `git pull --rebase origin <branch>` then retry once. Conflicts -> `git rebase --abort`, report, stop. Never force.

`--no-push` exists for callers that batch pushes (`/burndown`) or when the branch has no upstream yet.

## Report

- Issue id + title.
- Files changed, one short phrase each.
- Verification commands + results.
- Commit SHA + message.
- Pushed branch, or why not.
- **Not verified** — any acceptance criterion needing hardware or a device. Say it plainly; a closed issue must not imply observed-working.

## Never

- Open or update a PR. That is `/pr`.
- Edit a PR description.
- Create or switch branches.
- Close an issue whose verification did not pass.
- Amend, rebase, or reset outside the single push-retry above.
- Stage files unrelated to the issue.
