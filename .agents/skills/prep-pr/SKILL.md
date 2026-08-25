---
name: prep-pr
description: Prepare or refresh an initial feature PR from a PRD/issues/PR context, including empty-branch placeholder PRs. Use when the user wants a long-running implementation PR set up with future-facing title/body, linked PRD/issues, and navigation for follow-up task branches.
---

# Prep PR

Prepare a feature PR as the stable landing place for a PRD or issue group. This skill is for the "initial PR" before or during task-by-task implementation, so it must work even when the branch has no code changes yet.

## Core rules

- The PR title/body describe the **finished feature**, not the current diff.
- Never write copy like "this PR sets up docs" unless the feature really is only docs. Use final-feature language such as "This PR adds..." or "This PR implements...".
- If the branch has no changes or no commits ahead of base, create an empty commit so GitHub can host the PR.
- New initial feature PRs start as draft PRs. Use `gh pr create --draft` unless the user explicitly asks for a ready PR.
- If a PR already exists for the current branch, update that PR instead of creating a duplicate — but only after the Branch safety check confirms the current branch belongs to this feature. Never overwrite an unrelated PR's title/body.
- Keep the PR useful for navigation: link the PRD, all implementation issues, and any tracking parent issue.
- Label the PR with the union of linked issues' `area:*` labels and the highest linked `complexity:*` level. Never copy triage/workflow labels.
- Do not close or modify the PRD/issues unless the user explicitly asks.
- Use `gh` for GitHub operations. This repo is private; do not fetch GitHub issue/PR pages over unauthenticated HTTP.
- Follow repo branch rules from `AGENTS.md`: do not add generated prefixes to branch names.

## Inputs to discover

Prefer discovery before asking:

1. Current branch and base branch.
2. Existing PR for the current branch: `gh pr view --json number,title,body,baseRefName,headRefName,url`.
3. PRD and implementation issues:
   - From user-provided issue/PR numbers.
   - From current PR body.
   - From issue references in recent conversation if available.
   - From GitHub issue labels/titles only if needed.
4. Current local diff and branch-ahead status:
   - `git status --short --branch`
   - `git diff --stat`
   - `git log --oneline <base>..HEAD`

Ask one concise question only if no PRD/issues/PR context can be inferred.

## Branch safety check

Run this before creating or refreshing any PR. The skill keys off the current branch, so a mechanical run on the wrong branch can clobber an unrelated PR or graft this feature onto someone else's work.

The current branch is safe to use only if **one** of these holds:

- It has no commits ahead of base and no existing PR (a clean placeholder branch), or
- It already hosts a PR/commits for **this same** PRD/issue group (a refresh of the intended feature branch).

Stop and confirm with the user when the current branch looks unrelated, i.e. any of:

- Commits ahead of base whose messages/issue refs point at a different feature.
- An existing PR whose linked PRD/issues differ from the target PRD/issue group.
- The branch name clearly belongs to another feature.

In that case do **not** refresh the existing PR. Ask the user, and prefer branching a fresh feature branch off base (e.g. `dev`):

Branch off the fetched remote base, never off a local `dev` that may be behind:

```bash
git fetch origin <base> && git checkout -b <feature-name> origin/<base>
```

Only proceed on the current branch once it passes this check or the user explicitly approves it.

## Empty branch handling

If the user wants a PR prepared but there are no file changes and no commits ahead of base:

1. Create or switch to the intended feature branch.
2. Run:
   ```bash
   git commit --allow-empty -m "Prepare <feature-name> work"
   ```
3. Push the branch.
4. Create the draft PR with the future-facing feature title/body.

If there are staged or unstaged changes, commit the actual changes instead of making an empty commit.

## PR title

Use a short feature title, not a task title.

Good:

```text
Add link integrity
Implement Refloat-scoped tunes
Add ride export
```

Bad:

```text
Document link integrity plan
Set up initial docs
WIP
```

If an existing PR title is too focused on current setup/docs, update it to the finished feature.

## PR body

Before writing or refreshing a PR body or applying PR labels, read `../references/pr-description.md` and follow its shared description and label contracts. Prepared feature PRs describe intended finished behavior, not only work already landed.

Use this shape by default:

```md
<One to three short sentences describing the feature outcome and why it matters.>

> [!NOTE]
> **Risk:** <Low | Medium | High> — <short reason>
> **Complexity:** <Low | Medium | High> — <short reason>
> **DB:** <category> — <short impact>

## Tasks

- PRD: #<id>
- #<issue>
- #<issue>

## Description

<Problem solved, final behavior, and important design or user-facing constraints.>
```

Omit `## Tasks` only when no PRD, implementation issue, or tracking parent exists. Keep the body short. It should help future agents understand and navigate the feature, not duplicate the PRD or inventory changed files.

## Issue links

When implementation issues exist, include them in dependency order if known. GitHub already renders issue titles for bare refs, so do not repeat the issue title after the ref. Add a short task description only when it helps explain the role of the task in the feature branch.

```md
- #193
- #194
```

Add a short explanation after an issue ref only when its role cannot be understood from the issue title.

If the PR is a feature parent where all tasks will merge into it, say that explicitly:

```md
All implementation work is tracked in the issues above and can merge back into this branch.
```

## Existing PR refresh

If a PR already exists:

1. Read its body.
2. Preserve any useful links/comments.
3. Replace stale current-diff wording with future-facing feature wording.
4. Keep PRD/issues navigation.
5. Update title/body with `gh pr edit`.
6. Add missing applicable `area:*` labels, remove stale `complexity:*` labels, then apply exactly one complexity label. Preserve unrelated human-added labels; never copy issue triage/workflow labels.

## Final response

Return the PR URL first, then one short summary of what was prepared:

```text
PR ready: <url>

Updated the draft feature PR with linked PRD/issues.
```
