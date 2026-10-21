# PR description contract

Use this shape for new PR bodies. Describe outcome and problem, not changed-file inventory.

```md
<One to three short sentences: what this PR delivers and why it matters.>

> [!NOTE]
> **Risk:** <Low | Medium | High> <1–10>/10 - <short reason>
> **Complexity:** <Low | Medium | High> <1–10>/10 - <short reason>
> **DB:** None | Read-only | Data change | Migration | Schema + data — <short impact>

## Tasks

- #<issue>
- #<issue>

## Description

<Explain the problem, intended outcome, important behavior, and key design constraints.>
```

## Rules

- Start with a plain-language TL;DR of one to three short sentences. No heading.
- Always include Risk, Complexity, and DB. Pick one level/category, then give one short concrete reason.
- Use `DB: None — no persistence changes` when the PR does not touch a database or durable data model.
- Score Risk and Complexity independently from 1–10: Low = 1–3, Medium = 4–6, High = 7–10. Risk describes potential harm or regressions; Complexity describes implementation difficulty and precision needed. Explain each score briefly, e.g. `**Risk:** High 7/10 - sensor input controls board tilt`.
- Keep the existing DB categories and impact explanation. When a migration is included, append `⚠️ Includes migration` to the DB line.
- Use `[!WARNING]` instead of `[!NOTE]` when Risk is High or a migration is included. Keep all three fields in the same admonition.
- Tasks is optional. Include it for prepared feature PRs when implementation issues exist; omit it for ordinary PRs unless a task checklist helps navigation.
- Use plain issue refs (`- #123`) in dependency order when known. GitHub already renders each issue's open/closed status; do not duplicate it with Markdown checkboxes. Link a PRD or tracking parent with the same plain-bullet style.
- Description explains what problem is solved, what feature or behavior lands, and any important architectural or user-facing constraints.
- Do not write file inventories, commit summaries, generic changelogs, or lists like “updated X, added Y, changed Z.”
- Do not duplicate the PRD or issue bodies. Keep enough context to understand the PR without opening every link.
- Preserve useful human-written context and links when updating an existing body.

## PR labels

Read `../../../docs/agents/issue-tracker.md` and `../../../docs/agents/triage-labels.md` before choosing labels.

- Every new or refreshed PR gets one or more matching `area:*` labels and exactly one `complexity:low`, `complexity:medium`, or `complexity:high` label.
- Reuse repo issue-label vocabulary exactly. Never create a new label as part of PR creation.
- When linked issues exist, copy the union of their `area:*` labels except `area:db`, which follows the migration rule below. Choose the highest complexity carried by any linked implementation issue.
- Without linked issues, infer area from feature scope and complexity from risk/precision needed, using issue-tracker definitions. Complexity is not change size.
- Add `area:native` when native scope applies. Add `area:db` only when the PR includes a database migration, or explicitly plans one in a prepared feature PR. Database reads, writes, and persistence fixes alone do not qualify. Remove `area:db` when no migration remains in scope, even if a linked issue carries it.
- Do not copy triage/workflow labels such as `ready-for-agent`, `ready-for-human`, `needs-triage`, `needs-info`, or `wontfix`.
- When refreshing a PR, preserve unrelated human-added labels. Remove stale `complexity:*` labels so exactly one remains; add missing applicable `area:*` labels.

Apply labels after PR creation or body refresh:

```bash
gh pr edit <number> --add-label "area:<slug>,complexity:<level>"
```
