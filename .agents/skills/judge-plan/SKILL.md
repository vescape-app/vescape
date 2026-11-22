---
name: judge-plan
description: Stress-test a published plan (a spec with task tickets, or just an ordered set of tickets, optionally with a prepared PR) with a fresh read-only reviewer subagent that checks it against the real code, then verify its findings and fold the worthwhile ones back into the plan. Use when the user invokes `/judge-plan`, accepts the offer `/to-tickets` makes after publishing a slice set (always ask first, never run it unprompted), asks to "judge", "review", or "sanity-check" a spec or ticket set, or wants a second model's opinion on a plan before implementation.
---

# Judge Plan

A plan written in conversation carries the author's blind spots. A cold reviewer reads it against the code and finds wrong assumptions and unspecified rules. You keep the bigger context: you decide which findings hold and update the plan.

## Invocation

```text
/judge-plan 59             # spec issue; slices discovered from it
/judge-plan 61,62,63       # ticket set without a spec, in dependency order
/judge-plan 60             # prepared PR; spec + tickets from its body
/judge-plan                # plan from the current conversation / branch PR
```

No plan found → ask. Never guess.

## 1. Gather the plan

- Read the spec (if any), every ticket, and the PR body (if any) (`gh issue view` / `gh pr view`). Use the tracker in `docs/agents/issue-tracker.md`.
- List the code areas the plan touches, so the reviewer gets concrete starting paths (including companion repo paths under `../vescape/`, `../vescape-server/`, or `../vescape-web/` when a wire contract or mirrored schema is touched).

## 2. Spawn the reviewer

One subagent, read-only, using the strongest model your harness offers unless the user names one. Run it in the foreground; you need its result next.

The prompt must include:

- The plan references (ticket/PR numbers + how to read them) and the repo docs to read: `AGENTS.md`, `GLOSSARY.md` (and `../vescape/GLOSSARY.md` for shared terms), relevant `docs/agents/` and `docs/` pages, and `docs/adr/`.
- The starting code paths from step 1.
- **Read-only**: no edits to files, issues, or PRs.
- What to hunt:
  - wrong assumptions about existing code
  - rules that contradict each other or leave edge cases open
  - persistence, migration safety, native lifecycle, and data integrity realities
  - wire contract drift against companion repos (`../vescape`, `../vescape-server`, `../vescape-web`)
  - auth/authorization boundaries and scoping
  - slice order, missing slices, wrong complexity
  - violations of `AGENTS.md`, repo architecture docs, and domain glossary terms
  - anything an AFK agent would have to guess
- Output: a prioritized list (severity, ticket #, problem, `file:line` evidence, suggested fix). No praise. Word cap (~800).

## 3. Judge the findings

The reviewer has the code but not the conversation. You have both. For each finding:

- **Verify** claims about code with a quick grep or read before accepting them. Reviewers do misread; reject what the code contradicts.
- **Check against decisions** the user already made. A finding that reopens a settled product decision is not a fix: drop it or surface it as a question.
- **Keep** findings that would make an implementer guess, ship a bug, or break a contract. **Drop** nitpicks and style preferences.

Report to the user: kept findings grouped by impact, rejected ones with the one-line reason, and the planned edits. Then apply them, unless a kept finding changes product behavior; ask about that one first.

## 4. Apply to the plan

- Put rules where the implementer reads them: a `## Specification details` section in the affected ticket, plus matching acceptance criteria.
- If there is a spec, add a short clarifications bullet to its Implementation Decisions; don't rewrite it. Without a spec, the tickets are the whole plan: put shared rules in the first ticket that needs them and reference it from the rest.
- New slices go through `/to-tickets` conventions (title, labels, complexity, Likely files). Renumber sibling titles to keep dependency order. Update native blocking edges (or `Blocked by`) and every sibling's `## Related`.
- Refresh the PR task list and body if what it claims changed (see `prep-pr`).
- Don't close tickets, and don't touch code.

## 5. Final response

The tickets and PR changed, one line each, plus any still-open question the reviewer raised that the plan can't settle without the user or an external contract.
