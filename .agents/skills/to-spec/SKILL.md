---
name: to-spec
description: Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed.
disable-model-invocation: true
---

This skill takes the current conversation context and codebase understanding and produces a spec (you may know this document as a PRD). Do NOT interview the user — just synthesize what you already know.

The issue tracker, area labels, and triage label vocabulary live in `docs/agents/issue-tracker.md`. Domain docs live in `GLOSSARY.md` (and `../vescape/GLOSSARY.md` for shared terms) and `docs/adr/`.

## Titles and area tags

Keep spec titles short and scannable.

```text
[Spec][<Area>] <Short noun phrase>
```

Examples:

```text
[Spec][Sync] Ride history backup
[Spec][Auth] Account provisioning
```

Rules:

- Use 2-5 meaningful words after the prefixes. Prefer a noun phrase over a sentence.
- Pick one primary area from the area-labels table in `docs/agents/issue-tracker.md`.
- Before publishing, ask the user to confirm the prefix. Propose the best one you inferred and say whether it maps to an existing area label.
- If no existing area fits, propose a new short prefix and its label slug (`[Rate Limits]` -> `area:rate-limits`) and ask whether to create it.
- If the user approves a new area, add the row to the area-labels table in `docs/agents/issue-tracker.md` before or alongside publishing.
- Normalize obvious typos in issue metadata (`grup-ride` -> `group-ride`). If the user gives an explicit bracket tag, use it as written after fixing only clear typos.

Keep the confirmation focused:

```text
Proposed spec prefix: [Sync] (maps to existing `area:sync`).
Use this, or another prefix? Fallback suggestion: [Backup] with `area:backup`.
```

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

Check with the user that these seams match their expectations. In the same approval step, ask the user to confirm the spec title prefix using the rules above.

3. Write the spec using the template below, then publish it to the project issue tracker. Apply the `ready-for-agent` triage label and the matching area label - no need for additional triage. If the confirmed prefix uses a new area label, update `docs/agents/issue-tracker.md` before or alongside publishing.

<spec-template>

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

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>
