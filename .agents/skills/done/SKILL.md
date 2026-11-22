---
name: done
description: Finish the current tracked ticket by verifying work, committing scoped changes with the ticket id, and closing the ticket. Use when user invokes `/done`, `/done <ticket-id>`, says "finish ticket #...", or asks to commit and close an implemented ticket.
---

# Done

Use this skill after implementation is complete and the user wants the ticket finalized.

## Communication

Use `caveman` full style when that skill is available, else terse: no filler, no preamble, no
restating the task. Keep commands, file paths, ticket titles, commit messages, and errors
exact.

## Invocation

```text
/done
/done 123
/done #123
/done https://github.com/OWNER/REPO/issues/123
```

Extract the ticket id from the prompt when present. If missing, infer it from the current
conversation first, especially the most recent ticket fetched in this chat. If still unknown,
inspect local hints such as branch name, recent commit messages, or ticket references in
working notes. Ask only when inference fails or several plausible ids exist.

## Read order

1. Repo rules:
   - `AGENTS.md`
   - `docs/agents/issue-tracker.md`
   - `docs/agents/domain.md` (if present)
   - `docs/agents/architecture.md` (if present)
2. Resolve the ticket id, per Invocation.
3. Fetch the ticket:
   - `gh issue view <id> --json number,title,body,state,labels,assignees,comments,url --jq '.'`
   - This repo is private. Never fetch ticket content over unauthenticated HTTP.
4. Inspect local work:
   - `git status --short`
   - `git diff --stat`
   - `git diff`

## Workflow

1. **Confirm scope**
   - Identify the files changed for this ticket.
   - Unrelated changes are not staged.
   - Scope unclear, or the diff mixes unrelated work -> stop and ask.

2. **Verify**
   - Run focused checks relevant to the changed files. Prefer the commands already used
     during implementation.
   - `bun` for everything: `bun test`, `bun run typecheck`, `bun run lint` (or the repo's
     documented check scripts in `package.json`).
   - Run the repo's full check script when the change is broad or touches persistence/native
     boundaries; a focused run is enough otherwise.
   - If verification requires external services, a database, or a device that isn't available,
     say why and ask before committing.

3. **Commit**
   - Stage only this ticket's files.
   - Ticket id in the message, matching `to-code`'s format — `<summary> #<id>`:

```text
Add Account Role column #36
Correct Sync Cursor comparison #21
```

- Multi-ticket commit -> all ids on the first line.
- Closing happens explicitly with `gh issue close`, not through a commit keyword.
- No `Co-Authored-By`, no generated-with footer.
- Never amend, rebase, reset, or rewrite history unless the user explicitly asks.

4. **Close the ticket**
   - Only after the commit succeeds.

```bash
gh issue close <id> --comment "Implemented in <commit-sha> on <branch>."
```

- One line. Commit sha and branch, nothing else.
- Never restate what was verified. No test counts, no typecheck status, no summary of the
  work — the commit and diff already say it.
- Add lines only when something went wrong or is unfinished: an acceptance criterion not
  met, a skipped or failing test, a workaround, a follow-up needed. One line each, plain.

```text
Implemented in aed1980 on dev.

Left out: the CHECK constraint rejects legacy rows written before 0011 — needs a backfill ticket.
```

5. **Report**
   - Ticket id.
   - Commit SHA and message.
   - Verification commands and result.
   - Whether the ticket closed.

## Guardrails

Stop and ask before committing or closing when:

- The working tree has unrelated unstaged changes that cannot be separated safely.
- Tests fail.
- Verification was skipped for a non-trivial change.
- The ticket is already closed.
- The user asked for commit only, or close only.

Do not push unless the user explicitly asks.
