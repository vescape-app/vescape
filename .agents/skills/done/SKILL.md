---
name: done
description: Finish current tracked issue by verifying work, committing scoped changes with the issue id, and closing the issue. Use when user invokes `/done`, `/done <issue-id>`, says "finish issue #...", or asks to commit and close an implemented issue.
---

# Done

Use this skill after implementation is complete and user wants issue finalized.

## Communication

Use `caveman` full style when that skill is available, else terse: no filler, no preamble, no restating the task. Keep commands, file paths, issue titles, commit messages, and errors exact.

## Invocation

```text
/done
/done 123
/done #123
/done https://github.com/OWNER/REPO/issues/123
```

Extract issue id from prompt when present. If missing, infer it from current conversation context first, especially the most recent issue fetched in this chat. If still unknown, inspect local hints such as branch name, recent commit messages, or issue references in working notes. Ask for issue id only when inference fails or multiple plausible ids exist.

## Read Order

1. Read repo instructions:
   - `AGENTS.md`
   - `docs/agents/issue-tracker.md`
   - `docs/agents/domain.md`
2. Resolve issue id.
   - Prefer explicit prompt id.
   - Else use current chat context from the most recent fetched issue.
   - Else infer from branch name or recent local git context if unambiguous.
   - Ask only if no single issue id is clear.
3. Fetch issue using configured tracker docs.
   - For GitHub, use `gh issue view <id> --json number,title,body,state,labels,assignees,comments,url --jq '.'`.
   - Do not fetch private GitHub issue content with unauthenticated HTTP.
4. Inspect local work:
   - `git status --short`
   - `git diff --stat`
   - `git diff`

## Workflow

1. **Confirm Scope**
   - Identify files changed for this issue.
   - If unrelated changes exist, do not stage them.
   - If issue scope is unclear or diff mixes unrelated work, stop and ask.

2. **Verify**
   - Run focused checks relevant to changed files.
   - Prefer commands already used during implementation.
   - Use `bun` for JS/TS scripts and tests.
   - If verification cannot run, state reason and ask before committing.

3. **Commit**
   - Stage only files for this issue.
   - Commit with issue id in message.
   - Preferred formats:

```text
Issue #123: Add ride export
Fix #123: Correct telemetry pruning
```

- Use `Fix #<id>` only when the commit should auto-link as a fix. Closing still happens explicitly with `gh issue close`.
- Never amend, rebase, reset, or rewrite history unless user explicitly asks.

4. **Close Issue**
   - Close only after commit succeeds.
   - Use GitHub CLI:

```bash
gh issue close <id> --comment "Implemented in <commit-sha> on <branch>."
```

- One line. Commit sha + branch, nothing else.
- Never restate what was verified. No `bun test` counts, no typecheck status, no summary of the work — commit and diff already say it.
- Add extra lines only when something went wrong or is unfinished: acceptance criterion not met, test skipped or failing, workaround taken, follow-up needed. One line each, plain statement of the problem.

```text
Implemented in aed1980 on dev.

Left out: `/download/ios` redirect still points at the old TestFlight link — needs a store URL.
```

5. **Report**
   - Issue id.
   - Commit SHA and message.
   - Verification commands and result.
   - Closed issue status.

## Guardrails

Stop and ask before commit/close when:

- Working tree has unrelated unstaged changes that cannot be separated safely.
- Tests fail.
- Verification was skipped for a non-trivial change.
- Issue appears already closed.
- User asks for commit only or close only.

Do not push unless user explicitly asks.
