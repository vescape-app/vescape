---
name: delete-comment
description: Remove ordinary code comments from the requested scope and tighten comment lint.
disable-model-invocation: true
---

# Delete comments

Use the requested files or directory as the scope. With no scope, scan the repository and start with the largest coherent group of violations.

1. Run `bun run comments:check --list` to locate ordinary comments, including grandfathered ones. Append repo-relative file paths to limit the scan. Review source formats outside lint coverage directly when they are in scope.
2. Read each comment with its code and parity peers. Delete narration, stale notes, and commented-out code. Use clearer names or structure when they can express the intent without changing behavior. Move unwritten, durable constraints into the existing topic doc or an ADR. Preserve valid `@parity`, full platform differences, and legally or mechanically significant comments under the Code Comments policy in `AGENTS.md`.
3. Run `bun run comments:check --inventory` and compare the output with `scripts/comment-baseline.json`. Reduce counts or remove entries for deletions. Each entry identifies a file and the hash of an exact comment, so a new comment cannot spend an old allowance. Leave existing cleanup outside the requested scope grandfathered.
4. Run `bun run comments:check` and `git diff --check`. Review literals, generated inputs, and embedded scripts where a comment delimiter could be data. Report comment lines removed, remaining violations or manual-only files in scope, and any relocated decisions.
