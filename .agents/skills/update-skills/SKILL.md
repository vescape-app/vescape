---
name: update-skills
description: Edit, add, remove, or sync agent skills under `.agents/skills/` across the Vescape repositories while keeping shared skills sourced from `../vescape-home/skills/`. Use whenever the user asks to update, tweak, create, delete, or sync any skill or `.agents/skills/` file.
---

# Update Skills

Shared workflow skills across `vescape`, `vescape-server`, and `vescape-web` have a single source of truth: `../vescape-home/skills/`. Repo-specific skills live only in their own repository's `.agents/skills/`.

Never edit a shared skill's local copy directly — edits there will drift or get overwritten on the next sync.

## 1. Classify the skill

Check whether the skill exists in `../vescape-home/skills/`:

- **Exists in `../vescape-home/skills/<name>/`** → **shared skill**. Always edit it in `../vescape-home/skills/<name>/`, never in the current repo's `.agents/skills/<name>/`.
- **Exists only in the current repo's `.agents/skills/<name>/`** → **repo-specific skill** (e.g. `admin-ui`, `code-review`, `e2e`, `expo-module`, `wear`, `tdd`, `codebase-design`, `handoff`). Edit it directly in the current repo.
- **Creating a new skill** → decide whether it applies across Vescape repos (create in `../vescape-home/skills/<name>/`) or only this repo (create in local `.agents/skills/<name>/`). If unclear, ask the user.
- **Promoting / removing a shared skill** → move/delete it in `../vescape-home/skills/` and clean up any obsolete copy in sibling repos (`sync` only manages directories present in `skills/`).

## 2. Authoring rules for shared skills

- Keep shared skills **repo-agnostic**: no repo-specific frameworks, DB engines, folder trees, or hardcoded area tables. Delegate repo-specific rules to each repo's `AGENTS.md` and `docs/agents/issue-tracker.md`.
- Use the unified **`spec`** (`[Spec][<Area>]`) and **`ticket`** (`[<Area>] <n> - ...`) terminology.
- If a change is genuinely repo-specific, put it in that repo's `AGENTS.md`, `docs/agents/*`, or a repo-specific skill instead of branching inside a shared skill.

## 3. Sync from `vescape-home`

Before syncing, check sibling repo branches/working trees (`git -C ../<repo> status -sb`) so you don't unexpectedly dirty an in-progress feature branch.

```bash
# Sync all 3 sibling repos + vescape-home/.agents/skills symlinks
cd ../vescape-home && bun run sync

# Or sync specific repos only when another sibling is mid-branch
cd ../vescape-home && bun run sync -- --target vescape-server,vescape-web

# Verify zero drift
cd ../vescape-home && bun run sync:check
```

## 4. Commit & report

- Commit in `vescape-home` first, then commit the synced `.agents/skills/` changes in each updated sibling repo (only when asked to commit/push, or if the user asked to ship the skill update).
- If `../vescape-home` is not present on disk, stop and tell the user rather than silently editing a shared skill locally.
