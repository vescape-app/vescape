---
name: release-notes
description: Draft and review canonical rider-facing Vescape release notes. Use when authoring notes for a release candidate, revising a generated release-note draft, or checking release-note editorial policy before publishing.
---

# Release Notes

Run the repository authoring loop:

```bash
bun run release-notes:author
```

Pass `--sha=<ref>` or `--version=<x.y.z>` only when overriding the defaults. The command resolves and shows the previous published release, target SHA, marketing version, and comparison range before invoking local Codex. It keeps drafts temporary and writes `release-notes/<version>.md` only after explicit acceptance.

## Editorial policy

- Write for riders. Describe user-visible behavior and outcomes, not implementation.
- State only claims verified from the compared source diff. Inspect real changes; never infer behavior from commit titles alone.
- Put safety-related changes first within the relevant section and explain their rider impact plainly.
- Omit internal refactors, dependency churn, test-only work, release plumbing, and developer tooling unless riders experience a direct change.
- Use concise Markdown only: headings, paragraphs, and lists. Do not use HTML, code blocks, images, tables, or a document-level title.
- Use only `## New`, `## Improved`, `## Fixed`, and `## Watch`, in that order. Omit empty sections. The app supplies the document-level version context.
- Put every wrist-facing change under `## Watch`, whatever its kind — new wrist feature, wrist improvement, or wrist fix. The phone sections describe the phone app only, so a change that riders experience on the watch never appears twice.
- A change that riders experience on both surfaces belongs in the phone section, with a `## Watch` bullet only when the wrist behavior is distinct.
- Focus on important rider-visible outcomes. Do not inventory every small change.
- Combine related changes into one coherent bullet. For example, summarize multiple Alert changes under their most important rider outcome, adding only essential supporting detail.
- Lead each section with its most important change. Add smaller bullets only when they communicate a distinct rider-visible outcome.
- Do not include the version as a heading. The app supplies version metadata.
- Do not add promises, marketing filler, commit hashes, issue numbers, or contributor notes.

After manual canonical edits, run:

```bash
bun run release-notes:build
bun run release-notes:check
```
