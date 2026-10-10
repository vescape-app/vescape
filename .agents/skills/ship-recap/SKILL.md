---
name: ship-recap
description: Briefly recap changes since the last production release and what would ship now. Use for /ship-recap or a quick unreleased-changes overview.
---

Give a cheap, read-only shipping recap. Default candidate is committed HEAD; honor an explicit target or baseline.

1. Resolve the latest production release with `gh api repos/vescape-app/vescape/releases/latest --jq .tag_name`. Here tags and prereleases can represent internal builds, so the newest Git tag is not the production baseline. If unavailable, label any local fallback as unverified. Fetch only a missing baseline tag if needed.
2. Read `git status --short`, the current branch, and `git log --no-merges --format='%h %s' <baseline>..HEAD`, substituting the requested target. Confirm the baseline is an ancestor; if it is not, flag the diverged comparison instead of claiming a clean release delta.
3. Group related commits into product changes. Use a scoped commit body or diff only where a title is unclear, work appears partial, or a revert may cancel a change. Keep investigation narrow: no full source audit, subagents, tests, or release-note authoring workflow.

Return one scope line, `Since <release> → <branch/target>`, then roughly 5–10 short bullets, fewer when appropriate. Lead with meaningful features and fixes; mention platform limits or unfinished work when evident. Collapse internal maintenance into at most one bullet. Omit commit-by-commit narration, hashes, and minor tooling churn. Aim for under 200 words.

Include only changes present in the candidate. Uncommitted work and unmerged PRs are outside this recap; if the working tree is dirty, add one short note that local edits are excluded. Treat this as a change overview, not verified release readiness. If nothing changed, say so. Finish after the recap without editing files or publishing anything.
