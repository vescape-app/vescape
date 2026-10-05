---
name: designs-update
description: Synchronize Vescape's Penpot designs from the recorded commit to latest remote dev, verify affected designs, and write a checkpoint with a short change report.
---

# Update designs from dev

Use the sibling [designs skill](../designs/SKILL.md) for creation and fidelity rules. Read its
[workspace reference](../designs/references/workspace.md) and
[sync contract](../designs/references/sync.md) before accessing the checkpoint.

## Resolve the range

1. Verify the repository and configured Penpot file. Read the sync marker and coverage inventory.
2. Inspect working-tree state. Fetch `origin`'s `dev` and freeze its full SHA as the target for this
   run. Use that target's files, not unrelated local edits. Do not switch/reset a user's dirty
   checkout. Use `git show` for inspection or an isolated checkout for a required target build.
   If fetching fails, report the blocker; cached origin/dev is not proven to be latest.
3. Resolve the recorded SHA as a commit and require it to be an ancestor of the target. A missing
   object needs a fetch. A rewritten/diverged history needs reconciliation; do not replace the
   checkpoint with HEAD or quietly substitute a merge-base. A missing/null checkpoint takes the
   baseline branch below.

## Reconcile designs

Review `git diff --name-status --find-renames BASE TARGET`, the actual patches, and relevant
commit context. Map changes to the Penpot coverage catalog. Trace shared component, token,
font, icon, navigation, and state-contract changes through their screen callers, including
native changes that alter visible state. A file-extension or directory filter is insufficient.

- Update affected component masters and every covered screen/theme/state that consumes them.
  Apply the designs skill's auto layout and rendered-verification rules. Keep unaffected IDs,
  overrides, and accepted design-only proposals intact.
- Update renamed source mappings. For removed UI, inspect consumers and retire obsolete designs
  deliberately rather than deleting shared components still in use.
- Create designs for newly introduced rider-facing screens and reusable elements in the changed
  feature, with both appearances. The partial existing catalog does not require drawing every
  old undocumented route. Record unrelated uncovered surfaces explicitly; a newly changed feature
  cannot disappear from the report just because it had no coverage entry.
- Account for nonvisual changes with a short reason. Mark intentional illustrative charts/map
  crops as approximations. Unexpected fidelity defects are unresolved work, not approximations.
- New features or substantial shared/layout changes require fresh Android comparisons at the
  frozen target SHA. Small changes need source and Penpot render checks, as specified by designs.

**Baseline branch:** without a verified checkpoint, audit the existing covered components and
screens against the frozen target, repair the recorded pending defects, and verify both themes.
Create/update the coverage catalog. Only a completed audit establishes the first synced commit.
If the audit cannot finish, preserve null and report what remains; never guess a historical SHA.

## Finish

Once every relevant changed surface is reconciled and required verification passes, write the
checkpoint and latest report using the sync contract's reread/write/read-back procedure. If work
is incomplete, retain the previous checkpoint and record partial progress instead.

Return the Penpot link, old → new short SHA, affected screens/components, verification performed,
and remaining limitations. Say explicitly if the checkpoint was not advanced. Update the designs
skill's implementation notes when a newly observed tool failure or fidelity mistake yields a
durable lesson; keep transient build errors and task logs out of the skill.
