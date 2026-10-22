---
name: judge-plan
description: Stress-test a published plan (a PRD with task issues, or just an ordered set of issues, optionally with a prepared PR) with a fresh read-only reviewer subagent that checks it against the real code, then verify its findings and fold the worthwhile ones back into the plan. Use when the user invokes `/judge-plan`, accepts the offer `/to-issues` makes after publishing a slice set (always ask first, never run it unprompted), asks to "judge", "review", or "sanity-check" a PRD or issue set, or wants a second model's opinion on a plan before implementation.
---

# Judge Plan

A plan written in conversation carries the author's blind spots. A cold reviewer reads it against the code and finds wrong assumptions and unspecified rules. You keep the bigger context: you decide which findings hold and update the plan.

## Invocation

```text
/judge-plan 595            # PRD issue; slices discovered from it
/judge-plan 610,611,612    # issue set without a PRD, in dependency order
/judge-plan 601            # prepared PR; PRD + tasks from its body
/judge-plan                # plan from the current conversation / branch PR
```

No plan found → ask. Never guess.

## 1. Gather the plan

- Read the PRD (if any), every task issue, and the PR body (if any) (`gh issue view` / `gh pr view`). Use the tracker in `docs/agents/issue-tracker.md`.
- List the code areas the plan touches, so the reviewer gets concrete starting paths.

## 2. Spawn the reviewer

One subagent, read-only, using the strongest model your harness offers unless the user names one. Run it in the foreground; you need its result next.

The prompt must include:

- The plan references (issue/PR numbers + how to read them) and the repo docs to read: `AGENTS.md`, `CONTEXT.md`, relevant `docs/` pages, `docs/adr/`.
- The starting code paths from step 1, on both native platforms when the plan crosses them.
- **Read-only**: no edits to files, issues, or PRs.
- What to hunt:
  - wrong assumptions about existing code
  - rules that contradict each other or leave edge cases open
  - external API and data realities
  - lifecycle, threading and background behavior
  - slice order, missing slices, wrong complexity
  - violations of `AGENTS.md` (parity, native owns truth, domain terms)
  - anything an AFK agent would have to guess
- Output: a prioritized list (severity, issue #, problem, `file:line` evidence, suggested fix). No praise. Word cap (~800).

## 3. Judge the findings

The reviewer has the code but not the conversation. You have both. For each finding:

- **Verify** claims about code with a quick grep or read before accepting them. Reviewers do misread; reject what the code contradicts.
- **Check against decisions** the user already made. A finding that reopens a settled product decision is not a fix: drop it or surface it as a question.
- **Keep** findings that would make an implementer guess, ship a bug, or break a contract. **Drop** nitpicks and style preferences.

Report to the user: kept findings grouped by impact, rejected ones with the one-line reason, and the planned edits. Then apply them, unless a kept finding changes product behavior; ask about that one first.

## 4. Apply to the plan

- Put rules where the implementer reads them: a `## Specification details` section in the affected task issue, plus matching acceptance criteria.
- If there is a PRD, add a short clarifications bullet to its Implementation Decisions; don't rewrite it. Without a PRD, the issues are the whole plan: put shared rules in the first issue that needs them and reference it from the rest.
- New slices go through `/to-issues` conventions (title, labels, complexity, Likely files). Renumber sibling titles to keep dependency order. Update `Blocked by` and every sibling's `## Related`.
- Refresh the PR task list and body if what it claims changed (see `prep-pr`).
- Don't close issues, and don't touch code.

## 5. Final response

The issues and PR changed, one line each, plus any still-open question the reviewer raised that the plan can't settle without the user or the external API.
