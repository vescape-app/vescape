---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker using tracer-bullet vertical slices. Use when user wants to convert a plan into issues, create implementation tickets, or break down work into issues.
---

# To Issues

Break a Vescape app plan into independently-grabbable GitHub issues using vertical slices (tracer bullets).

The issue tracker and triage label vocabulary live in `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.

## Titles and Area Tags

Keep issue titles short and scannable.

If the source is a PRD with title:

```text
[PRD][<Area>] <PRD title>
```

then implementation issue titles must use:

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

- Use the same `<Area>` prefix for all issues spawned from one PRD unless a slice clearly belongs elsewhere.
- When there is no PRD, use the same `<Feature Tag>` prefix for all issues spawned from the same plan unless the user asks for separate tags.
- Number issue titles only when the issues are related slices in one coherent sequence, such as a PRD implementation plan or a multi-step feature plan.
- Do not number a single standalone issue.
- Do not number issues that happen to be created in the same turn but are unrelated to each other. Use each issue's own confirmed prefix and short verb phrase.
- If the user gives an explicit bracket tag/prefix, use it exactly after fixing only obvious typos.
- If the user does not give a tag, infer a short domain tag from the plan using the project's glossary vocabulary. Prefer a noun phrase over an implementation layer.
- Before publishing, ask the user to confirm the issue prefix. Propose the best inferred prefix, including whether it comes from the parent PRD, an existing app area, or a new feature tag.
- If no existing app area fits, propose a new short prefix and ask whether to create/use it. Also propose the matching GitHub area label slug when it should become a tracked area, e.g. `[Firmware Profiles]` -> `area:firmware-profiles`.
- Use the confirmed prefix for all issue titles unless a slice clearly needs a different confirmed prefix.
- Use 2-5 meaningful words after the prefix, or after the number when titles are numbered.
- When titles are numbered, number from the approved slice order, not GitHub issue number.
- Apply the matching GitHub area label, e.g. `area:sanitizers`, when one exists or when the user approves creating/using a new one.
- If the user approves a new area label, update the App-area labels table in `docs/agents/issue-tracker.md` in the same turn. Add the area label, title prefix, and a short "Use for" description before or alongside publishing the issues.
- If user types a typo for a known area, normalize it in issue metadata, e.g. `sanatizers` -> `sanitizers`.

When asking for prefix confirmation, keep it focused:

```text
Proposed issue prefix: [History] (from parent PRD, maps to existing `area:history`).
Use this, or should I create/use another prefix? My fallback suggestion: [Ride Export] with `area:ride-export`.
```

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes an issue reference (issue number, URL, or path) as an argument, fetch it from the issue tracker and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Issue titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

When publishing implementation issues, identify likely starting-point files while exploring. Prefer files that are already part of the behavior being changed, nearby tests, domain docs, native bridge/module entrypoints, route files, and established shared utilities. Keep this list small and useful: usually 3-8 paths, enough to give an AFK agent a head start without pretending the list is exhaustive.

For this app, include JS/TS route or domain files plus native Android/iOS module entrypoints when the slice crosses the bridge. Useful starting areas include `src/tune/`, `src/components/`, `src/hooks/`, `modules/vescape-core/`, `modules/vesc-native/`, `docs/tune.md`, `CONTEXT.md`, and relevant ADRs under `docs/adr/`.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Complexity**: low / medium / high (see `docs/agents/issue-tracker.md` for definitions)
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Is the proposed issue prefix correct? If not, what prefix should be used? If this needs a new prefix/area label, confirm the proposed label slug and `docs/agents/issue-tracker.md` table entry.
- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Publish the issues to the issue tracker

For each approved slice, publish a new issue to the issue tracker. Use the issue body template below. These issues are considered ready for AFK agents, so publish them with the correct triage label unless instructed otherwise. Every issue must also have exactly one `complexity:low`, `complexity:medium`, or `complexity:high` label (see `docs/agents/issue-tracker.md` for definitions). If the confirmed prefix uses a new area label, update `docs/agents/issue-tracker.md` before or alongside publishing.

Publish issues in dependency order (blockers first) so you can reference real issue identifiers in the "Blocked by" field. Do not publish concurrently when blocker references are needed.

After all issues in the group are published, do a second pass: edit each issue body to fill the `## Related` section with refs to every sibling issue in the same `[Area]`/`[Feature Tag]` group (excluding self). Use `gh issue edit <id> --body-file -` or `gh issue edit <id> --body "..."`. Use bare `#<id>` refs (e.g. `- #42`). GitHub auto-renders them as live links with current title + state icon — no manual title needed, stays in sync if titles change.

Before publishing, re-check each issue has a **Likely files** section. Paths are navigational hints, not ownership boundaries. Do not force a path into the list if you are guessing without codebase evidence; write "Unknown - inspect <area/module> first" only when the repo structure cannot be narrowed further.

<issue-template>
## Parent

A reference to the parent issue on the issue tracker (if the source was an existing issue, otherwise omit this section).

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

Avoid code snippets unless a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape). Inline that snippet here and note briefly that it came from a prototype. Trim to the decision-rich parts - not a working demo, just the important bits.

## Likely files

Starting points for implementation. Include repo-relative paths and one short reason each. These are hints, not a complete or mandatory file list.

- `src/or/modules/path.ts` - why this file is probably relevant

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

- A reference to the blocking ticket (if any)

Or "None - can start immediately" if no blockers.

## Related

All other issues in the same `[Area]`/`[Feature Tag]` group (siblings, blockers, follow-ups). Excludes self. Filled in after all group issues published. Use bare `#<id>` so GitHub renders live title + state icon.

- #<id>

Or "None" if this is a standalone issue with no group siblings.

</issue-template>

Do NOT close or modify any parent issue.
Predict the next issue id after creating first one to speed up issue creation with "related" inside. Then update first issue. If IDs differ, update them.
