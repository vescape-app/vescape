---
name: to-prd
description: Turn the current conversation context into a PRD and publish it to the project issue tracker. Use when user wants to create a PRD from the current context.
---

This skill takes the current conversation context and Vescape app codebase understanding and produces a PRD. Do NOT interview the user except for the explicit approval gates below - synthesize what you already know.

The issue tracker, app-area labels, and triage label vocabulary live in `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`. Domain docs live in `CONTEXT.md` and `docs/adr/`.

## Titles and Area Tags

Keep PRD titles short and scannable.

Format:

```text
[PRD][<Area>] <Short noun phrase>
```

Examples:

```text
[PRD][Sanitizers] Metric exclusions
[PRD][History] Ride rebuild
```

Rules:

- Use 2-5 meaningful words after the prefixes.
- Prefer noun phrases over sentences.
- Pick one primary app area from repo issue docs when available.
- Before publishing, ask the user to confirm the title prefix. Propose the best prefix you inferred, and explain whether it maps to an existing area label.
- If no existing app area fits, propose a new short title prefix and ask whether to create/use it. Also propose the matching GitHub area label slug, e.g. `[Firmware Profiles]` -> `area:firmware-profiles`.
- Use the confirmed prefix in the title.
- Apply the matching GitHub area label when one exists or when the user approves creating/using a new one.
- If the user approves a new area label, update the App-area labels table in `docs/agents/issue-tracker.md` in the same turn. Add the area label, title prefix, and a short "Use for" description before or alongside publishing the PRD.
- If user types a typo for a known area, normalize it in issue metadata, e.g. `sanatizers` -> `sanitizers`.

When asking for prefix confirmation, keep it focused:

```text
Proposed PRD prefix: [Tunes] (maps to existing `area:tunes`).
Use this, or should I create/use another prefix? My fallback suggestion: [Firmware Profiles] with `area:firmware-profiles`.
```

## Process

1. Explore the repo to understand the current state of the Vescape app codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you're touching.

For this app, check likely JS/TS route or domain files plus native Android/iOS module entrypoints when the PRD crosses the bridge. Useful starting areas include `src/tune/`, `src/components/`, `src/hooks/`, `modules/vescape-core/`, `modules/vesc-native/`, `docs/tune.md`, `CONTEXT.md`, and relevant ADRs under `docs/adr/`.

2. Sketch out the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.

A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

Check with the user that these modules match their expectations. Check with the user which modules they want tests written for. In the same approval step, ask the user to confirm the PRD title prefix using the rules above.

3. Write the PRD using the template below, then publish it to the project issue tracker. Apply the `ready-for-agent` triage label and the matching app-area label - no need for additional triage. If the confirmed prefix uses a new area label, update `docs/agents/issue-tracker.md` before or alongside publishing.

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts - not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.

</prd-template>
