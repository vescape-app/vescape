---
name: burndown
description: Burn down all task issues linked from a feature PR, one delegated subagent per issue, sequential on the PR branch. Each subagent implements, commits, pushes, and closes its issue; cross-agent review is per-task, at-end, or off. Undrafts the PR when the list hits zero. Use when the user invokes `/burndown`, points at a PR full of `ready-for-agent` issues, or says "implement all tasks from this PR".
---

# Burndown

Feature PR carries N task issues. Burn list to zero. One subagent per issue, one at a time, same branch.

You are orchestrator. You do NOT edit project code — Read only. Plan, delegate, sanity-check, report.

## Comms

Terse. No filler, no preamble, no restating the task. Code/commands/paths/issue ids exact.

## Skill boundary

This skill is project-local and shared across agents. Reference only repo skills in `.agents/skills/` and plain `gh`/`git`/`bun` commands. Never name a personal skill from the operator's own config — a subagent on another machine or another agent will not have it. Where the operator has a cross-agent review skill, they invoke or name it; this skill only decides _whether_ review happens.

## Invocation

```text
/burndown 382                  # PR number
/burndown                      # infer PR from current branch
/burndown https://github.com/OWNER/REPO/pull/382
/burndown 382 --only 379,381   # subset, keep dep order (no undraft)
/burndown 382 --review at-end  # skip the review-mode question
```

No PR + no branch match -> ask. Never guess the PR.

## Preflight (stop on fail, ask user)

- `gh auth status` fail -> stop.
- Not on PR head branch -> `git switch <headRefName>`, or ask if tree dirty.
- Dirty tree -> show `git status --porcelain`, ask: stash / commit first / proceed-and-tell-agents. Do NOT silently sweep. Pre-existing drift gets swept into a subagent commit otherwise.
- Zero issues resolved from PR -> stop, surface what you looked at.

## Step 1 — Resolve the task list

```bash
gh pr view <n> --json title,body,headRefName,url
```

Issue ids come from, in order:

1. `Navigation:` / `## Issues` section of PR body (`- #377, ...`).
2. `Closes #<id>` lines.
3. `gh issue list --search "<PR title words>" --label ready-for-agent`.

Then read every issue in full, one `gh issue view <id>` per issue:

```bash
gh issue view <id> --json number,title,state,labels,body
```

Already `CLOSED` -> skip, say so. Harvest per issue: **Blocked by**, `complexity:*` label, **Likely files**, acceptance criteria, and any ADR the issue names.

## Step 2 — Order the queue

Hard rule first: **Blocked by** wins. Then, among unblocked issues:

1. Issues other issues will build on, whose seam is small (arming policy, shared constants) — early.
2. `complexity:low` / self-contained — early.
3. `complexity:high` and anything touching app launch, native lifecycle, or build config — **last**.

Reason: later agents read earlier work and hook into seams it left. That is the whole payoff of sequential. Example from #382: `377 -> 380 -> 381 -> 379 -> 378`, where 378 (high, launch-time) landed on a claim seam 379 had just created.

Show the queue to the user before spawning. One line per issue, with why-that-slot.

## Step 2b — Ask review mode

Cross-agent review means: a second CLI agent reads the diff read-only and reports findings. The reviewer is whatever review skill the operator has configured — ask which one, or let them name it when they answer. This skill does not hardcode a reviewer.

Ask once, before the first agent. Never assume — each review is a full extra CLI run.

| Mode       | What happens                                                                      | When it fits                                                                                                      |
| ---------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `per-task` | each subagent gets its own diff reviewed, applies findings, then closes           | native/lifecycle work, load-bearing seams, high `complexity:*` — findings land while the author still has context |
| `at-end`   | no subagent reviews; one review over the whole branch diff after the queue drains | cheaper, catches cross-issue interaction, but fixes land without the implementing agent's context                 |
| `none`     | no cross-agent review at all                                                      | throwaway or trivial queues                                                                                       |

Default suggestion: `per-task` when any issue is `complexity:high` or touches native/launch/build config, else `at-end`.

Flag form skips the question: `/burndown 382 --review per-task|at-end|none`.

Chosen mode changes Step 3's closing instructions and whether Step 4b runs. Nothing else.

## Step 3 — Delegate, one at a time

One `Agent` call per issue. `subagent_type: general-purpose`, `model: "opus"`, low effort, `run_in_background: false`. Never batch two coding agents — they share the branch.

Prompt must be fully self-contained — subagent has zero context. Open with a terseness instruction (`Be terse. No preamble.`) or the operator's brevity skill if they name one.

Required prompt contents:

- Repo path, branch name, that the branch is checked out. `Read AGENTS.md first.`
- `gh issue view <id>` for the spec, plus every ADR path the issue names. Do not paraphrase the issue as the source of truth — make the agent read it.
- 5-10 line summary of the task so the agent knows the shape before reading.
- **What already landed on this branch** and any seam left for it. Name the file and symbol. `Don't touch that work.`
- Traps the issue flags (clock domains, threading, "verify before inventing a buffer").
- Staging discipline: `git status` may show pre-existing drift -> stage only your own files, never `git add -A`.
- No `Co-Authored-By`, no generated-with footer (repo rule).
- On `per-task` mode: the exact reviewer to use, named by the operator in Step 2b. The subagent cannot guess it.
- Closing instructions, in order — see below, varies by review mode.

Closing instructions on `per-task` mode:

```text
1. `bun run ts` clean; run the native/unit target you touched (`bun run test:ios`, `bun run test:android`, `bun test <path>`).
2. Commit short message referencing #<id>, push to origin/<branch>.
3. Run the cross-agent review named in this prompt. Apply findings you judge correct; skip noise. Commit + push fixes.
4. Close the issue: `gh issue close <id> --comment "Resolved in PR #<pr-number>. <one line what landed>"` — repo convention, matches `.agents/skills/to-pr`. Note in the comment any acceptance criterion you could not verify (device-only checks).
5. Report: files changed, decisions/deviations, review findings + disposition, issue closed y/n.
```

On `at-end` / `none` mode, drop step 3 and say so explicitly, or the agent invents its own review:

```text
3. Do NOT run any cross-agent or second-opinion review. Review happens later at branch level.
```

Ask for the report explicitly — subagent final output is not shown to the user, you relay it.

## Step 4 — Sanity-check between agents

Light. CI and the agent's own `ts`/tests cover correctness. You check:

```bash
git log --oneline <prev-sha>..HEAD
git diff <prev-sha>..HEAD --stat
```

- Right files touched? Nothing outside the issue's area?
- Read the one new/most-changed file. Does the approach make sense?
- Stray files in the commit (unrelated drift, scratch files)? -> surface to user.
- Seam the next issue needs — grep it exists before spawning the next agent.

Agent failed or reported blocked -> investigate yourself (read files, logs), then re-delegate narrower. Do not fix it by hand.

## Step 4b — Branch-level review (`at-end` mode only)

Queue drained. Run the operator's review once over the whole branch diff vs the PR base (`git diff <base>...HEAD`).

You are still orchestrator — do not apply fixes yourself. Findings go to one fresh subagent (opus, low, foreground, terse) with: the review doc path, the branch, and `apply what you judge correct, skip noise, commit + push, do not reopen closed issues`. Findings that need a real design change instead of a fix -> surface to the user, propose a follow-up issue.

Review after the issues are already closed means a finding cannot un-close its issue. That is the accepted cost of `at-end`; say it in the report.

Skip on `none`.

## Step 5 — Undraft the PR

Queue empty and every issue actually `CLOSED` -> mark PR ready for review:

```bash
gh pr ready <n>
```

Skip and say why when:

- Any issue still open, or an agent stopped short.
- PR was not a draft to begin with (`isDraft: false`) -> no-op, don't announce it.
- Only a subset ran (`--only`) and the PR still carries open tasks.

Refresh the PR body too when later work changed what it claims (repo rule: keep PR description current). Deviations from the issue specs belong in the body, not only in chat — e.g. a constant that landed at a different value than the issue asked for.

CI red is not a blocker for undrafting; report it, let the user decide.

## Step 6 — Report

After each issue: one short status line to user (issue, files, review outcome).

Final report:

- Table: issue | what landed | review findings. Drop the findings column on `none`.
- Review mode used, one line. On `at-end`, note that findings landed after the issues closed.
- **Deviations worth your call** — where an agent departed from the issue spec (different constant, added mechanism, skipped a review finding). Name them, don't bury them.
- **Not verified** — say plainly what no one proved. Native/device behavior, on-hardware acceptance criteria, anything only `xcodebuild`-compiled. Never let "issue closed" imply "observed working".
- Stray commits / drift swept in.

## Refusal triggers

Stop and ask when:

- PR has no resolvable issues.
- Issue is `needs-info` / `needs-triage`, not `ready-for-agent`.
- Blocked-by chain has a cycle, or points at an open issue outside this PR.
- Push rejected non-fast-forward -> surface, never force.
- Two agents would need the same file at once (means the queue order is wrong — re-order, don't parallelize).

One question at a time.

## Never

- Edit project code yourself.
- Run two coding subagents at once.
- Spawn a separate validator agent, or re-run the full `bun run check` after each issue. Wasteful — see AGENTS.md verification budget.
- Close an issue the agent did not actually finish.
