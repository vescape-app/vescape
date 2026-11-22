---
name: to-code
description: Turn a tracked ticket into focused code changes with local docs, code exploration, implementation, and verification. Use when user invokes `/to-code <ticket-id>`, says "implement ticket #...", or asks to pick up a GitHub ticket for coding.
---

# To Code

Implement one tracked ticket end-to-end.

## Comms

Caveman full style. Code/commands/paths/errors/labels exact.

## Invocation

```text
/to-code 123
/to-code #123
/to-code https://github.com/OWNER/REPO/issues/123
```

Extract id. Missing -> ask.

## Read Order

1. Repo rules:
   - `AGENTS.md`
   - `docs/agents/issue-tracker.md`
   - `docs/agents/domain.md`
2. Domain:
   - `../vescape/GLOSSARY.md` — shared domain source of truth
   - `GLOSSARY.md` if present
   - `docs/<feature>/` for the area touched
   - `docs/adr/*.md` and `../vescape/docs/adr/*.md` if relevant
3. Fetch ticket: `gh issue view <id> --json number,title,body,state,labels,assignees,comments,url --jq '.'`. No unauth HTTP for private.
4. Explore code + tests.

## Workflow

1. **Understand** — Goal, AC, unknowns. Vague/blocked -> stop, ask 1 question. Conflicts `GLOSSARY.md`/ADR -> surface first.
2. **Plan** — Smallest coherent impl. Name files. Start from ticket `## Likely files`, verify. Match existing conventions.
3. **Implement** — Focused edits. `bun` for everything. Follow `AGENTS.md` and the repo's architecture docs. When touching shared wire contracts or mirrored schemas, inspect the sibling repos (`../vescape`, `../vescape-server`, `../vescape-web`) — don't drift. No scope creep.
4. **Verify** — `bun run typecheck` + focused `bun test <file>` first. Broader if blast radius wide. Can't run -> say why.
5. **Report** — Ticket id. Files + behavior. Verify cmds + results. Real risks/follow-ups only.
6. **Commit on request** — Include id. Format: `<summary> #<id>`. Ex: `Expand delta chain in sanitizer #9`. Multi-ticket -> all ids first line.

## GitHub Ticket Fetch

```bash
gh issue view <id> --json number,title,body,state,labels,assignees,comments,url --jq '.'
```

Plain `gh issue view --comments` unreliable non-interactive. JSON works.

`gh issue comment <id> --body "..."` only if user asks or notes useful. Don't close unless asked.

## Refuse Until Clarified

- No concrete expected behavior.
- Multiple incompatible directions.
- Data integrity or migration correctness at risk.
- Needs creds/hardware/env not local.

One question at a time.
