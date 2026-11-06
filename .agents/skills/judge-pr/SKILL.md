---
name: judge-pr
description: "Check a PR or branch: the default whenever the user asks to check, re-check, look at, rate or score a PR, or asks if it is ready to merge. Re-checks earlier review threads against the code, audits durable data changes, and scores clarity, code quality and complexity with what would raise each."
---

Read-only verdict on one PR or branch, done inline by you. Every claim comes from code you read at the pinned head.

## Steps

### 1. Pin the evidence

Resolve the head SHA and fetch it. For a PR, also read the description, linked issues, CI state, every review thread and every top-level comment; `gh api graphql` is the source for `reviewThreads`.

Done when you hold the SHA and all threads, including resolved and outdated ones. Read files with `git show "${sha}:path"`, because the local checkout may be on another branch.

### 2. Settle every thread

Treat replies and the PR description as claims. Open the code each one points at, following it if the file moved, and give every thread one status:

- **Fixed**: the code at head removes the problem.
- **Answered, not solved**: the reply is true but leaves the reported failure in place.
- **Not done**: the problem is still there, possibly smaller.
- **Decision**: a real tradeoff only a maintainer can settle.
- **Obsolete**: the code it concerned is gone and the problem went with it.

Check that the reasoning in a reply actually covers the reported case. Done when every thread has a status backed by code you read.

### 3. Audit durable data

Rider data is the most crucial part of the app: a bad migration can destroy rides that nothing can restore. Decide from the diff, not the PR's `DB:` line: look for changes to Room or GRDB code, `modules/vescape-core/schema/database.json`, schema exports, backup formats, and anything else persisted. If the PR's `DB:` line disagrees with the diff, that is a finding.

With no durable changes, report `DB: None`, naming what you checked, and move on. Otherwise read [`persistence-tests`](../persistence-tests/SKILL.md) for the contract and answer each question that applies from code:

- **Existing data**: what happens to every row on a device upgrading from each shipped version? Look for rows dropped, values defaulted or rewritten, and failures that replace installed data.
- **Failure midway**: is each multi-write operation one transaction? What state survives a crash or failure partway?
- **Parity**: do Room and GRDB, `database.json` and the committed Room export all agree?
- **Backups**: do old archives still restore, and do archives still move between Android and iOS?
- **Rollback**: can a user who downgrades or reinstalls an older build still open their data?
- **Evidence**: do real-code tests seed old-version rows and assert their values after upgrade? Did `persistence-contracts` pass for this exact SHA?

Done when every applicable question has an answer citing code or a test, or is marked unverified.

### 4. Hunt suspects

Read the riskiest logic in the diff, not only the areas reviewers touched. For each suspect, trace the path until it is confirmed or cleared, and report only the confirmed ones:

- State that stops updating, lifecycle gaps, resets that miss a field, event ordering.
- `@parity` peers: read both sides, and treat a shared bug as one finding on both platforms.
- `AGENTS.md` rules: native owns long-lived work, no dead or duplicated code, code in the right directory.
- Tests that tooling cannot see, or that cover only the happy path.

Done when the riskiest paths are traced and each finding names a symbol or `file:line`, the rider-visible effect, and a fix. Mention what you did not run, and validation the PR lists as pending.

### 5. Score

Give each area an integer and one or two sentences of evidence that name concrete things:

- **Clarity**: can a reader follow the intent, behaviour and ownership from the description, docs and code?
- **Code quality**: correctness, readability and structure. Confirmed bugs count here.
- **Complexity**, where 10 is simple: size, state and moving parts relative to what the feature needs. Say what is justified and whether simpler options were actually compared.

**Merge readiness** is a verdict, not an average. Any confirmed bug that riders would hit, or a required validation still pending, caps it at 6. Possible data loss, or a durable-data question left unverified, caps it at 3. Green CI does not raise it.

### 6. Report

Use this order, and keep it short enough to read in a minute:

```markdown
**Merge readiness: N/10.** One sentence on the verdict and what blocks it.

**DB:** None, or the changes, the risk to existing data and the evidence.

| Thread | Status | What's there now |   <- omit if there are no threads

| Area | Score | Why |
| Clarity | N/10 | ... |
| Code quality | N/10 | ... |
| Complexity | N/10 (10 = simple) | ... |

**To get it to about N/10:**
1. Most valuable action first, naming the file or behaviour.

Decisions for the maintainer, with your recommendation.
```

Done when every score below 8 has an action that would raise it, or you state plainly that no cleanup will, as when the complexity comes from a design choice, and name what would settle that choice.

Post to GitHub only when asked, then link the comment.
