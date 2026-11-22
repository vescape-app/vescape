---
name: to-tickets
description: Break a plan, spec, or conversation into a set of tracer-bullet tickets with native blocking edges on GitHub Issues.
disable-model-invocation: true
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker, area labels, and triage label vocabulary live in `docs/agents/issue-tracker.md`. Domain docs live in `GLOSSARY.md` (and `../vescape/GLOSSARY.md` for shared terms) and `docs/adr/`.

## Titles and area tags

Keep ticket titles short and scannable.

If the source is a spec titled `[Spec][<Area>] <title>`, tickets reuse that area:

```text
[<Area>] <number> - <Short verb phrase>
```

Examples:

```text
[Sync] 1 - Land raw frames
[Sync] 2 - Expand delta chain
```

With no spec source, infer a feature tag instead and use the same shape.

Number **only** when publishing two or more related slices from one coherent sequence. A single standalone ticket, or several unrelated tickets created in the same turn, drops the number:

```text
[Group Ride] Fix roster stale flag
[Core] Add migration runner
```

Rules:

- Use 2-5 meaningful words after the prefix, or after the number when numbered.
- Numbers come from the approved slice order, not the GitHub issue number.
- Use the same prefix for every ticket from one spec unless a slice clearly belongs elsewhere.
- Before publishing, ask the user to confirm the prefix. Say whether it comes from the parent spec, an existing area label, or a new feature tag.
- If no existing area fits, propose a new prefix and its label slug (`[Rate Limits]` -> `area:rate-limits`) and ask whether to create it. If approved, add the row to the area-labels table in `docs/agents/issue-tracker.md` in the same turn.
- If the user gives an explicit bracket tag, use it as written after fixing only clear typos. Normalize known typos in issue metadata (`grup-ride` -> `group-ride`).

Keep the confirmation focused:

```text
Proposed ticket prefix: [Sync] (from parent spec, maps to existing `area:sync`).
Use this, or another prefix? Fallback suggestion: [Backup] with `area:backup`.
```

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number, or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

While exploring, collect **likely starting-point files** for each ticket. Prefer files already part of the behaviour being changed, their nearby tests, domain docs, feature modules, routes/views, persistence/migrations (if applicable), and established shared modules. Keep the list small and useful: normally 3-8 paths, enough to give an AFK agent a head start without pretending it is exhaustive.

Check `docs/agents/issue-tracker.md` for this repo's useful starting areas and companion-repo contract paths.

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision, dashboard change, or watched production migration. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, queries, routes, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket; green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Complexity**: low / medium / high (see `docs/agents/issue-tracker.md` for definitions)
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Is the proposed ticket prefix correct? If it needs a new prefix, confirm the label slug and the `docs/agents/issue-tracker.md` table entry.
- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?
- Are the correct slices marked as HITL and AFK, and do the complexity ratings look right?

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the issue tracker

Publish one GitHub issue per approved ticket in dependency order (blockers first) so blocking edges reference real issue identifiers. Do not publish concurrently when blocker references are needed.

- Use GitHub's native sub-issue link when the source was an existing spec/parent issue (`docs/agents/issue-tracker.md`).
- Use GitHub's native blocking edges (`--blocked-by` / `--add-blocked-by`) so blockers are UI-visible and queryable. Omit the `## Blocked by` body section when blockers were set as native edges.
- Apply `ready-for-agent` (unless instructed otherwise, or `ready-for-human` for a HITL slice an agent genuinely cannot finish), the matching `area:*` label(s), and exactly one `complexity:low`, `complexity:medium`, or `complexity:high` label.
- If the confirmed prefix uses a new area label, update `docs/agents/issue-tracker.md` before or alongside publishing.
- After all tickets in the group are published, fill each ticket's `## Related` section with bare `#<id>` refs to every sibling ticket in the same `[Area]`/`[Feature Tag]` group (excluding self). GitHub auto-renders bare `#<id>` as live links with current title and state icon. Predict the next issue id after creating the first one to speed up creation with `## Related` already inside, then update the first issue (and patch any others if IDs drifted).
- Before publishing, re-check each ticket has a `## Likely files` section. Paths are navigational hints, not ownership boundaries. Do not guess paths without codebase evidence; write "Unknown - inspect `<area>` first" only when the repo structure cannot be narrowed further.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

<issue-template>

## Parent

A reference to the parent spec/issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behaviour this ticket makes work, from the caller's or user's perspective, not layer-by-layer implementation.

Avoid code snippets unless a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape). Inline that snippet here and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## Likely files

Starting points for implementation. Include repo-relative paths and one short reason each. These are hints, not a complete or mandatory file list.

- `src/sync/expand.ts` - delta carry-forward lives here
- `src/db/migrations/` - new schema goes in a numbered file

## Implementation hints

Code-level hints to help AFK agents navigate the implementation without guessing. Include when the codebase exploration revealed non-obvious integration points. Skip this section for trivial slices.

Good hints:

- Exact code patterns to follow or replace (with file + line reference)
- Existing call sites that need modification (quote the current code)
- Data shapes, sign conventions, or contract fields that are easy to get wrong
- Helper functions or patterns already in the codebase that should be reused

Bad hints:

- Restating what "What to build" already says
- Full implementation code (that belongs in the PR, not the issue)
- Guesses about code you haven't actually read

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- A reference to each blocking ticket, or "None (can start immediately)". Omit this section when blockers were set as native edges.

## Related

All other tickets in the same `[Area]`/`[Feature Tag]` group (siblings, blockers, follow-ups). Excludes self. Filled in after all group tickets published. Use bare `#<id>` so GitHub renders live title + state icon.

- #<id>

Or "None" if this is a standalone ticket with no group siblings.

</issue-template>

Do NOT close or modify any parent issue.

### 6. Offer a plan review

After publishing two or more related slices, ask once: "Run `/judge-plan <spec#>` (or `/judge-plan <ticket#,ticket#,…>` when there is no spec) to have a fresh reviewer check the plan against the code?" Run it only on yes. Skip the question for a single standalone ticket.
