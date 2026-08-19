---
name: pr
description: Create a branch, commit, push, and open/update a PR on GitHub from the current working tree. Works with or without an issue — just needs changes and a prompt. Use when user invokes `/pr`, `/pr "title"`, says "open a PR", "push and create PR", or wants to ship current work to GitHub.
---

# PR

Branch, commit, push, and open/update a GitHub PR from the current working tree.

## Comms

Caveman full style. Code/commands/paths/labels/PR titles exact.

## Invocation

```text
/pr
/pr "Add dark mode support"
/pr --title "Add dark mode" --branch feature/dark-mode
```

No args -> infer title from changes. Quoted string -> use as PR title.

## Preflight (stop on fail, ask user)

1. `gh auth status` fail -> stop.
2. `git status --porcelain` empty -> not a failure, a common entry point (`/burn` already committed and pushed). Resolve in this order:
   - PR exists for branch -> report URL, done.
   - No PR but branch has commits ahead of `dev` (`git log --oneline dev..HEAD`) -> skip Steps 3-4, go straight to Step 5 and open the PR.
   - No PR and nothing ahead of `dev` -> stop, nothing to ship.
3. `gh pr list --head <branch>` returns >1 -> stop, ask which.

## Step 1 — Assess changes

```bash
git diff --stat
git diff --cached --stat
git status --porcelain
```

Understand what changed. Use this to infer commit message and PR title/body if not provided.

## Step 2 — Branch

- Already on feature branch (not `main`/`dev`) -> reuse.
- On `main` or `dev` -> create new branch. Derive name from title or changes: `<area-slug>-<short-desc>` (kebab, 2-4 words).

Branch off `origin/dev`, never off local `dev`. A local `dev` that is a few commits behind produces
a PR whose diff conflicts with work that already merged, and the conflict only shows up after the
PR is open.

```bash
git fetch origin dev
git checkout -b <branch-name> origin/dev
```

Uncommitted work carries over the `checkout` untouched, so run this before Step 3 either way.

If user passed `--branch`, use that exact name.

## Step 3 — Commit

Stage and commit all relevant changes. One commit.

```bash
git add <files>
git commit -m "<concise summary>"
```

Commit message: 1 line, imperative mood, focused on what changed. If an issue id is known (passed by caller), append `#<id>`.

## Step 4 — Push

First push: `git push -u origin <branch>`. Later: `git push`. No rebase. No force.

## Step 5 — PR

Before writing a new PR body or applying PR labels, read `../references/pr-description.md` and follow its shared description and label contracts.

Detect existing:

```bash
gh pr list --head <branch> --base dev --json number,url,body --jq '.[0]'
```

### No PR -> create

Always ready (not draft). Base = `dev`.

```bash
gh pr create --base dev --title "<title>" --body "$(cat <<'EOF'
<1-3 short sentences describing the outcome and why it matters.>

> [!NOTE]
> **Risk:** <Low | Medium | High> — <short reason>
> **Complexity:** <Low | Medium | High> — <short reason>
> **DB:** <category> — <short impact>

## Description

<Problem solved, behavior delivered, and important constraints.>
EOF
)"
```

Describe the feature/problem outcome. Do not produce a changed-file inventory or per-commit changelog. Ordinary PRs omit `## Tasks` unless a checklist materially helps navigation.

Title: use user-provided title, else derive scope in this order:

1. `[Area] N - ...` prefix on the issue -> title the PR after the **feature**, not the single issue (`[Area] <feature noun>`), since siblings will land on the same branch.
2. Parent PRD linked in the issue body -> PRD title.
3. Single issue with no area group -> issue title.
4. No issue -> infer from the diff.

Keep under 70 chars.

### PR exists -> update

Push new commits. Report the URL. **Leave the body alone** — auto-maintained PR descriptions are noise.

Refresh applicable `area:*` labels and ensure exactly one `complexity:*` label per the shared contract. Never copy issue triage/workflow labels.

Edit the body only when the user asks, or when the work made an existing claim false (body says "~30s", code landed 60s). Then fix that line only:

```bash
gh pr edit <number> --body-file <path>
```

Never add generated sections, changelogs, or per-commit notes. Never remove existing entries.

## Step 6 — Report

- PR url + number.
- Branch name.
- Files changed.
- Commit message.

## Caller protocol

Other skills (like `/burndown`) can invoke `/pr` by following this skill's steps directly. When called by another skill:

- Branch name may be pre-determined by caller -> use it, skip Step 2 inference.
- Commit message may be pre-determined -> use it, skip inference.
- PR title and body may be pre-determined -> use them.
- Issue ids for `Closes #<id>` may be passed -> include in PR body.

## Refusal Triggers

Stop and ask when:

- `gh` not authed.
- Multiple PRs from same branch.
- Push rejected (non-fast-forward) -> surface, don't force.
- Dirty tree has mix of unrelated changes -> show diff, ask: commit all / select files / abort.

One question at a time.
