---
name: judge-pr
description: Adversarial, zero-trust PR/branch audit and merge-readiness verdict. Use when you don't trust an implementation or want to judge or score a PR.
---

Adversarial, zero-trust verdict on one PR or branch at its pinned head SHA (`git show "${sha}:path"` — never trust local checkout). Treat descriptions, commit messages, close comments, and replies as unverified claims until code at head proves them.

Read-only. Never run local linters, typecheckers, builds, or tests — read CI check runs for `<sha>` instead.

## Audit

1. **CI coverage**: read check runs for `<sha>` and flag skipped, stale, or red jobs.
2. **Spec & threads**: verify linked ticket/spec/ADR acceptance criteria against head (catch silent scope cuts, stubbed paths, unwired halves). Fetch all review threads including resolved/outdated (`gh api graphql` `reviewThreads`), follow moved files, and mark each: **Fixed** | **Answered, not solved** | **Not done** | **Decision** | **Obsolete**.
3. **Adversarial [`code-review`](../code-review/SKILL.md)** on `<base>...<sha>`:
   - Always emit `DB:` explicitly (even `DB: None`, naming what was checked). A PR `DB:` line disagreeing with the diff is a finding.
   - Actively try to break it: auth/scoping leaks, migration safety on existing data, sync/persistence/native lifecycle edge cases, wire contract drift with companion repos (`../vescape`, `../vescape-server`, `../vescape-web`), gamed or weakened tests, silent fallbacks masking errors, speculative abstractions, and drive-by edits.

## Score

Integer + 1–2 sentences naming concrete files/symbols for **Clarity**, **Code quality**, and **Complexity** (10 = simple).

**Merge readiness** is a verdict, not an average:

- Possible data loss, cross-Account data leak, or unverified migration risk -> **cap 3**.
- Confirmed bug, unmet AC, dodged thread (`Answered, not solved` / `Not done`), weakened test, or missing required CI validation -> **cap 6**.
- Green CI never raises a cap.

## Report

Keep it readable in under a minute:

```markdown
**Merge readiness: N/10.** Verdict and blocker.

**DB:** None (what was checked), or changes, data risk, and evidence.
**CI / Validation:** What ran on `<sha>`, what was skipped/stale/red, what needs deploy/live testing.

| Thread | Status | What's there now | <- omit if none

| Area | Score | Why |
| Clarity | N/10 | ... |
| Code quality | N/10 | ... |
| Complexity | N/10 (10 = simple) | ... |

**Findings:** <- omit if none

- `file:line` (`symbol`) — effect. Fix: ...

**To get it to about N/10:**

1. Highest-leverage action first (cover every score < 8, or state plainly why cleanup won't raise it).

Decisions for the maintainer, with recommendation.
```

Post to GitHub only when asked, then link the comment.
