---
name: burn
description: Implement one tracked ticket and close it on the current branch — `/to-code` then `/done`, no PR ceremony. Use when the user invokes `/burn <ticket-id>`, says "implement and close #123", or wants a ticket finished on a branch that already exists.
---

# Burn

One ticket, implemented, committed, closed, and pushed on the branch already checked out. `/to-code` + `/done` + `git push`.

Invoking `/burn` authorizes the ticket commit and push. Continue through both without asking for separate confirmation. `--no-push` skips only the push; the commit is still required.

No PR, no branch creation. Need a PR opened -> `/burn --no-push` then `/pr`. Want N tickets
off one PR -> `/burndown` (it delegates a burn per ticket).

On a branch that already has a PR, burn is the whole flow: it pushes, the PR updates itself,
nothing else to run.

## Comms

Use `caveman` full style when available, else terse. Code/commands/paths/ticket ids exact.

## Invocation

```text
/burn 123
/burn #123
/burn https://github.com/OWNER/REPO/issues/123
/burn 123 --no-push     # commit + close locally, leave push to caller
```

Missing id -> infer from branch name or the most recent ticket fetched in this chat.
Ambiguous -> ask.

## Preflight (stop on fail, ask user)

- Ticket already `CLOSED` -> stop, say so. Never re-close.
- Ticket labelled `needs-info` / `needs-triage` -> stop, ask. Only `ready-for-agent` (or an
  explicit user go-ahead) is burnable.
- Ticket labelled `ready-for-human` -> stop. It is marked that way because an agent cannot
  finish it: dashboard access, a watched production migration, a design call.
- **Blocked by.** The ticket body names its blockers. Any blocker still open -> stop, say
  which. A ticket is ready when its blockers are closed.
- **Branch fit.** Compare the ticket's `area:<slug>` label / `[Area]` title prefix against the
  current branch name:
  - `main` or `dev` (default/integration branch) -> `On <branch>, no feature branch. Burn here?` Wait.
  - Feature branch whose name does not match the ticket's area -> `branch <name> vs ticket area <area>. Burn here?` Wait.
  - Match, or no area signal -> proceed silently.

  Yes -> burn on that branch. **Never offer or create another branch** — that is `/pr`'s job.

- Dirty tree with changes unrelated to this ticket -> show `git status --short`, ask: stash /
  commit first / proceed-and-leave-unstaged. Never sweep them into the ticket commit.
- **Never create, switch, or rename a branch.** Burn works on what is checked out.

## Step 1 — Implement

Follow `.agents/skills/to-code/SKILL.md`, **Workflow** steps 1-5 (Understand, Plan,
Implement, Verify, Report).

Skip step 6 (commit) — `/done` owns the commit.

That skill's refusal triggers stay in force: no concrete expected behavior, incompatible
directions, or missing credentials -> stop and ask, one question at a time.

Respect `AGENTS.md`, any ADRs the ticket names, and the repo's architecture docs (e.g.
`docs/agents/architecture.md` if present).

## Step 2 — Close

Follow `.agents/skills/done/SKILL.md` with the resolved ticket id. It owns the verification
gate, scoped staging, the commit message format, and the close comment.

Do not re-run to-code's verification — `/done` verifies. One gate, not two.

Tests fail -> `/done` stops. Do not close, do not push. Surface and stop.

## Step 3 — Push (default on)

`/done` deliberately does not push. Burn does, unless `--no-push`:

```bash
git push origin <current-branch>
```

Rejected non-fast-forward -> `git pull --rebase origin <branch>` then retry once. Conflicts ->
`git rebase --abort`, report, stop. Never force.

`--no-push` exists for callers that batch pushes (`/burndown`) or when the branch has no
upstream yet.

## Report

- Ticket id + title.
- Files changed, one short phrase each.
- Verification commands + results.
- Commit SHA + message.
- Pushed branch, or why not.
- **Not verified** — any acceptance criterion nobody proved. Anything needing a physical device,
  deployed environment, production database, or external dashboard. Say it plainly; a closed
  ticket must not imply observed-working.

## Never

- Open or update a PR. That is `/pr`.
- Edit a PR description.
- Create or switch branches.
- Close a ticket whose verification did not pass.
- Amend, rebase, or reset outside the single push-retry above.
- Stage files unrelated to the ticket.
