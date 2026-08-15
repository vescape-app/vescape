---
name: to-code
description: Turn a tracked issue into focused code changes with local docs, code exploration, implementation, and verification. Use when user invokes `/to-code <issue-id>`, says "implement issue #...", or asks to pick up a GitHub/local issue for coding.
---

# To Code

Implement one VESC issue end-to-end.

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
   - `docs/agents/react.md` if RN UI
2. Domain:
   - `CONTEXT.md` if present
   - `docs/tune.md` if tune r/w
   - `docs/adr/*.md` if relevant
3. Fetch issue: `gh issue view <id> --json number,title,body,state,labels,assignees,comments,url --jq '.'`. No unauth HTTP for private.
4. Explore code + tests.

## Workflow

1. **Understand** — Goal, AC, unknowns. Vague/blocked -> stop, ask 1 question. Conflicts `CONTEXT.md`/ADR -> surface first.
2. **Plan** — Smallest coherent impl. Name files. Start from issue `## Likely files`, verify. Match existing conventions.
3. **Implement** — Focused edits. Native = truth, JS = view. `bun` for JS. Native test cmds only if native touched. Routes/layouts in `src/app/`; hooks/helpers/components elsewhere. No scope creep.
4. **Verify** — Focused tests first. Broader if blast radius wide. Can't run -> say why.
5. **Report** — Issue id. Files + behavior. Verify cmds + results. Real risks/follow-ups only.
6. **Commit on request** — Include id. Format: `<summary> #<id>`. Ex: `Move avg filtering into sanitizer #25`. Multi-issue -> all ids first line.

## GitHub Issue Fetch

```bash
gh issue view <id> --json number,title,body,state,labels,assignees,comments,url --jq '.'
```

Plain `gh issue view --comments` unreliable non-interactive. JSON works.

`gh issue comment <id> --body "..."` only if user asks or notes useful. Don't close unless asked.

## Refuse Until Clarified

- No concrete expected behavior.
- Multiple incompatible directions.
- Safety-sensitive board behavior at risk.
- Needs creds/hardware/env not local.

One question at a time.
