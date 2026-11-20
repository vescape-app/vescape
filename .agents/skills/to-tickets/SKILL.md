---
name: to-tickets
description: Break a plan, spec, or PRD into a set of tracer-bullet tickets with native blocking edges on GitHub Issues.
disable-model-invocation: true
---

# To Tickets

Break a Vescape app plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and triage label vocabulary live in `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.

## Titles and Area Tags

Keep ticket titles short and scannable.

If the source is a PRD/spec with title:

```text
[PRD][<Area>] <PRD title>
```

then implementation ticket titles must use:

```text
[<Area>] <number> - <Short verb phrase>
```

Only use numbered titles when publishing two or more related implementation slices from the same PRD or plan.

Examples:

```text
[Sanitizers] 1 - Move avg filter
[History] 2 - Rebuild buckets
```

If there is no PRD source/title, choose a regular feature tag instead:

```text
[<Feature Tag>] <number> - <Short verb phrase>
```

For a single standalone issue, or for multiple unrelated issues being created in the same turn, omit the number:

```text
[<Feature Tag>] <Short verb phrase>
```

Examples:

```text
[Privacy Zone] 1 - Store zones
[Privacy Zone] 2 - Edit zones
[History] Add empty state
[Map] Fix style picker
```

Rules:

- Use the same `<Area>` prefix for all tickets spawned from one PRD unless a slice clearly belongs elsewhere.
- When there is no PRD, use the same `<Feature Tag>` prefix for all tickets spawned from the same plan unless the user asks for separate tags.
- Number ticket titles only when the tickets are related slices in one coherent sequence, such as a PRD implementation plan or a multi-step feature plan.
- Do not number a single standalone issue.
- Do not number issues that happen to be created in the same turn but are unrelated to each other. Use each issue's own confirmed prefix and short verb phrase.
- If the user gives an explicit bracket tag/prefix, use it exactly after fixing only obvious typos.
- If the user does not give a tag, infer a short domain tag from the plan using the project's glossary vocabulary. Prefer a noun phrase over an implementation layer.
- Before publishing, ask the user to confirm the ticket prefix. Propose the best inferred prefix, including whether it comes from the parent PRD, an existing app area, or a new feature tag.
- If no existing app area fits, propose a new short prefix and ask whether to create/use it. Also propose the matching GitHub area label slug when it should become a tracked area, e.g. `[Firmware Profiles]` -> `area:firmware-profiles`.
- Use the confirmed prefix for all ticket titles unless a slice clearly needs a different confirmed prefix.
- Use 2-5 meaningful words after the prefix, or after the number when titles are numbered.
- When titles are numbered, number from the approved slice order, not GitHub issue number.
- Apply the matching GitHub area label, e.g. `area:sanitizers`, when one exists or when the user approves creating/using a new one.
- If the user approves a new area label, update the App-area labels table in `docs/agents/issue-tracker.md` in the same turn. Add the area label, title prefix, and a short "Use for" description before or alongside publishing the tickets.
- If user types a typo for a known area, normalize it in issue metadata, e.g. `sanatizers` -> `sanitizers`.

When asking for prefix confirmation, keep it focused:

```text
Proposed ticket prefix: [History] (from parent PRD, maps to existing `area:history`).
Use this, or should I create/use another prefix? My fallback suggestion: [Ride Export] with `area:ride-export`.
```

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (an issue number, URL, or path) as an argument, fetch it from the issue tracker and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

When publishing implementation tickets, identify likely starting-point files while exploring. Prefer files that are already part of the behavior being changed, nearby tests, domain docs, native bridge/module entrypoints, route files, and established shared utilities. Keep this list small and useful: usually 3-8 paths, enough to give an AFK agent a head start without pretending the list is exhaustive.

For this app, include JS/TS route or domain files plus native Android/iOS module entrypoints when the slice crosses the bridge. Useful starting areas include `src/modules/`, `src/components/`, `src/hooks/`, `modules/vescape-core/`, `docs/`, `GLOSSARY.md`, and relevant ADRs under `docs/adr/`.

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
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

- Is the proposed ticket prefix correct? If not, what prefix should be used? If this needs a new prefix/area label, confirm the proposed label slug and `docs/agents/issue-tracker.md` table entry.
- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the issue tracker

Publish one GitHub issue per approved ticket in dependency order (blockers first) so blocking edges reference real issue identifiers. Do not publish concurrently when blocker references are needed.

- Use GitHub's native sub-issue link when the source was an existing PRD/parent issue (`docs/agents/issue-tracker.md`).
- Use GitHub's native blocking edges (`--blocked-by` / `--add-blocked-by`) so blockers are UI-visible and queryable. Omit the `## Blocked by` body section when blockers were set as native edges.
- Apply `ready-for-agent` (unless instructed otherwise), the matching `area:*` label(s), and exactly one `complexity:low`, `complexity:medium`, or `complexity:high` label.
- If the confirmed prefix uses a new area label, update `docs/agents/issue-tracker.md` before or alongside publishing.
- After all tickets in the group are published, fill each ticket's `## Related` section with bare `#<id>` refs to every sibling ticket in the same `[Area]`/`[Feature Tag]` group (excluding self). GitHub auto-renders bare `#<id>` as live links with current title and state icon. Predict the next issue id after creating the first one to speed up creation with `## Related` already inside, then update the first issue (and patch any others if IDs drifted).
- Before publishing, re-check each ticket has a `## Likely files` section. Paths are navigational hints, not ownership boundaries. Do not guess paths without codebase evidence; write "Unknown - inspect `<area/module>` first" only when the repo structure cannot be narrowed further.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

<issue-template>

## Parent

A reference to the parent issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective, not layer-by-layer implementation.

Avoid code snippets unless a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape). Inline that snippet here and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## Likely files

Starting points for implementation. Include repo-relative paths and one short reason each. These are hints, not a complete or mandatory file list.

- `src/modules/path.ts` - why this file is probably relevant

## Implementation hints

Code-level hints to help AFK agents navigate the implementation without guessing. Include when the codebase exploration revealed non-obvious integration points. Skip this section for trivial slices.

Good hints:

- Exact code patterns to follow or replace (with file + line reference)
- Existing call sites that need modification (quote the current code)
- Data shapes, sign conventions, or direction flags that are easy to get wrong
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

All other issues in the same `[Area]`/`[Feature Tag]` group (siblings, blockers, follow-ups). Excludes self. Filled in after all group issues published. Use bare `#<id>` so GitHub renders live title + state icon.

- #<id>

Or "None" if this is a standalone issue with no group siblings.

</issue-template>

Do NOT close or modify any parent issue.

### 6. Offer a plan review

After publishing two or more related slices, ask once: "Run `/judge-plan <PRD#>` (or `/judge-plan <issue#,issue#,…>` when there is no PRD) to have a fresh reviewer check the plan against the code?" Run it only on yes. Skip the question for a single standalone issue.
