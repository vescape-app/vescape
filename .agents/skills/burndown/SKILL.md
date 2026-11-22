---
name: burndown
description: Burn down all tickets linked from a feature PR, one delegated subagent per ticket, sequential on the PR branch. Each subagent implements, commits, pushes, and closes its ticket; cross-agent review is per-task, at-end, or off. Undrafts the PR when the list hits zero. Use when the user invokes `/burndown`, points at a PR full of `ready-for-agent` tickets, or says "implement all tickets from this PR".
---

# Burndown

Feature PR carries N tickets. Burn list to zero. One subagent per ticket, one at a time, same
branch.

Each ticket is one `/burn` (`.agents/skills/burn`) — implement + verify + commit + close. This
skill owns queue order, delegation, review mode, and the PR undraft; `/burn` owns the
per-ticket work.

You are orchestrator. You do NOT edit project code — Read only. Plan, delegate, sanity-check,
report.

## Comms

Terse. No filler, no preamble, no restating the task. Code/commands/paths/ticket ids exact.

## Skill boundary

This skill is project-local and shared across agents, so it must not depend on any one
operator's private skill dir.

- Repo skills in `.agents/skills/` (`done`, `to-code`, `pr`, ...) — reference freely, every
  agent has them.
- Plain `gh` / `git` / `bun` commands — always fine.
- Widely-installed personal skills (`caveman`) — reference as optional only:
  `use /caveman if available`. Never as a hard requirement.
- Cross-agent review skills (which CLI reviews the diff) — never hardcoded. The operator names
  the reviewer in Step 2b; this skill only decides _whether_ review happens.

## Invocation

```text
/burndown 44                  # PR number
/burndown                     # infer PR from current branch
/burndown https://github.com/OWNER/REPO/pull/44
/burndown 44 --only 39,40     # subset, keep dep order (no undraft)
/burndown 44 --review at-end  # skip the review-mode question
```

No PR + no branch match -> ask. Never guess the PR.

## Preflight (stop on fail, ask user)

- `gh auth status` fail -> stop.
- Not on the PR head branch -> `git switch <headRefName>`, or ask if the tree is dirty.
- Dirty tree -> show `git status --porcelain`, ask: stash / commit first /
  proceed-and-tell-agents. Do NOT silently sweep. Pre-existing drift gets swept into a
  subagent commit otherwise.
- Zero tickets resolved from the PR -> stop, surface what you looked at.

## Step 1 — Resolve the ticket list

```bash
gh pr view <n> --json title,body,headRefName,url
```

Ticket ids come from, in order:

1. `## Tasks` / `Navigation:` section of the PR body (`- #39`, ...).
2. `Closes #<id>` lines.
3. `gh issue list --search "<PR title words>" --label ready-for-agent`.

Then read every ticket in full, one `gh issue view <id>` per ticket:

```bash
gh issue view <id> --json number,title,state,labels,body
```

Already `CLOSED` -> skip, say so. `ready-for-human` -> skip, say so; it is marked that way
because an agent cannot finish it. Harvest per ticket: **Blocked by**, `complexity:*` label,
**Likely files**, acceptance criteria, and any ADR the ticket names.

## Step 2 — Order the queue

Hard rule first: **Blocked by** wins. Then, among unblocked tickets:

1. Tickets other tickets will build on, whose seam is small (a shared config shape, a column
   later tickets authorize on) — early.
2. `complexity:low` / self-contained — early.
3. `complexity:high` and high-hazard areas flagged in `docs/agents/issue-tracker.md` (e.g.
   `area:native`, `area:db`, `area:sync`, `area:auth`) — **last**.

Reason: later agents read earlier work and hook into seams it left. That is the whole payoff
of sequential.

Show the queue to the user before spawning. One line per ticket, with why-that-slot.

## Step 2b — Ask review mode

Cross-agent review means: a second CLI agent reads the diff read-only and reports findings.
The reviewer is whatever review skill the operator has configured — ask which one, or let them
name it when they answer. This skill does not hardcode a reviewer.

Ask once, before the first agent. Never assume — each review is a full extra CLI run.

| Mode       | What happens                                                                      | When it fits                                                                                                                |
| ---------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `per-task` | each subagent gets its own diff reviewed, applies findings, then closes           | schema migrations, query layer, anything that can corrupt backed-up data — findings land while the author still has context |
| `at-end`   | no subagent reviews; one review over the whole branch diff after the queue drains | cheaper, catches cross-ticket interaction, but fixes land without the implementing agent's context                          |
| `none`     | no cross-agent review at all                                                      | throwaway or trivial queues                                                                                                 |

Default suggestion: `per-task` when any ticket is `complexity:high` or carries a high-hazard
area label (`area:native`, `area:db`, `area:sync`, `area:auth`), else `at-end`.

Flag form skips the question: `/burndown <n> --review per-task|at-end|none`.

The chosen mode changes Step 3's closing instructions and whether Step 4b runs. Nothing else.

## Step 3 — Delegate, one at a time

One `Agent` call per ticket. `subagent_type: general-purpose`, `model: "opus"`, low effort,
`run_in_background: false`. Never batch two coding agents — they share the branch.

The prompt must be fully self-contained — the subagent has zero context. Open with
`/caveman if available, else be terse` so the agent compresses its own output without failing
when the skill is missing.

Required prompt contents:

- Repo path, branch name, that the branch is checked out. `Read AGENTS.md first.`
- `gh issue view <id>` for the spec, plus every ADR path the ticket names. Do not paraphrase
  the ticket as the source of truth — make the agent read it.
- 5-10 line summary of the task so the agent knows the shape before reading.
- **What already landed on this branch** and any seam left for it. Name the file and symbol.
  `Don't touch that work.`
- Traps the ticket flags (data integrity, migrations, native lifecycle, wire contracts, auth
  boundaries).
- Staging discipline: `git status` may show pre-existing drift -> stage only your own files,
  never `git add -A`.
- No `Co-Authored-By`, no generated-with footer (repo rule).
- On `per-task` mode: the exact reviewer to use, named by the operator in Step 2b. The
  subagent cannot guess it.
- Closing instructions, in order — see below, varies by review mode.

Closing instructions on `per-task` mode:

```text
1. Invoke the `burn` skill (`.agents/skills/burn`) with arg `<id>`. It implements, verifies, commits, closes, and pushes.
2. Then run the cross-agent review named above on your diff. Apply findings you judge correct; skip noise. Commit + push fixes.
3. Report: files changed, decisions/deviations, review findings + disposition, ticket closed y/n.
```

Review lands after `/burn` closed the ticket — a finding cannot un-close it. Acceptable:
findings become follow-up commits on the same branch. Reviewing before close would mean two
verification gates per ticket.

On `at-end` / `none` mode, replace step 2 explicitly, or the agent invents its own review:

```text
2. Do NOT run any cross-agent or second-opinion review. Review happens later at branch level.
```

Ask for the report explicitly — subagent final output is not shown to the user, you relay it.

## Step 4 — Sanity-check between agents

Light. CI and the agent's own tests cover correctness. You check:

```bash
git log --oneline <prev-sha>..HEAD
git diff <prev-sha>..HEAD --stat
```

- Right files touched? Nothing outside the ticket's area?
- Read the one new or most-changed file. Does the approach make sense?
- A migration in the diff -> read it. Additive with a default, or does it rewrite rows?
- Stray files in the commit (unrelated drift, scratch files) -> surface to the user.
- Seam the next ticket needs — grep it exists before spawning the next agent.

Agent failed or reported blocked -> investigate yourself (read files, logs), then re-delegate
narrower. Do not fix it by hand.

## Step 4b — Branch-level review (`at-end` mode only)

Queue drained. Run the operator's review once over the whole branch diff vs the PR base
(`git diff <base>...HEAD`).

You are still orchestrator — do not apply fixes yourself. Findings go to one fresh subagent
(opus, low, foreground, `/caveman if available`) with: the review doc path, the branch, and
`apply what you judge correct, skip noise, commit + push, do not reopen closed tickets`.
Findings needing a real design change instead of a fix -> surface to the user, propose a
follow-up ticket.

Review after the tickets are already closed means a finding cannot un-close its ticket. That
is the accepted cost of `at-end`; say it in the report.

Skip on `none`.

## Step 5 — Undraft the PR

Queue empty and every ticket actually `CLOSED` -> mark the PR ready for review:

```bash
gh pr ready <n>
```

Skip and say why when:

- Any ticket still open, or an agent stopped short.
- The PR carries a `ready-for-human` ticket nobody has done.
- The PR was not a draft to begin with (`isDraft: false`) -> no-op, don't announce it.
- Only a subset ran (`--only`) and the PR still carries open tickets.

Body: touch it **only** to correct a claim the work made false. Fix that line, nothing else.
No generated sections, no restating the diff. An untouched-but-still-true body is the correct
outcome.

CI red is not a blocker for undrafting; report it, let the user decide.

## Step 6 — Report

After each ticket: one short status line to the user (ticket, files, review outcome).

Final report:

- Table: ticket | what landed | review findings. Drop the findings column on `none`.
- Review mode used, one line. On `at-end`, note that findings landed after the tickets closed.
- **Deviations worth your call** — where an agent departed from the ticket spec (different
  shape, added mechanism, skipped a review finding). Name them, don't bury them.
- **Not verified** — say plainly what nobody proved. Anything needing a physical device,
  deployed environment, production database, or external dashboard. Never let "ticket closed"
  imply "observed working".
- Stray commits / drift swept in.

## Refusal triggers

Stop and ask when:

- The PR has no resolvable tickets.
- A ticket is `needs-info` / `needs-triage`, not `ready-for-agent`.
- The blocked-by chain has a cycle, or points at an open ticket outside this PR.
- Push rejected non-fast-forward -> surface, never force.
- Two agents would need the same file at once (the queue order is wrong — re-order, don't
  parallelize).

One question at a time.

## Never

- Edit project code yourself.
- Run two coding subagents at once.
- Spawn a separate validator agent, or re-run the full `bun run check` after every ticket.
  Wasteful — a focused check per ticket, the full gate once.
- Close a ticket the agent did not actually finish.
