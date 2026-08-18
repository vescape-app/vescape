# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. This is a private repo, so use the authenticated `gh` CLI from inside the local clone for all issue operations. Do not fetch GitHub issue pages over plain HTTP.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,state,labels,assignees,comments,url --jq '.'`. Prefer JSON output because plain `gh issue view --comments` can produce empty formatted output in non-interactive agent shells.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Create a label**: `gh label create "area:<slug>" --description "<short area description>"`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `vescape-app/vescape`.

## PRD issues

When publishing a PRD, create a GitHub issue whose title starts with `[PRD][<Area>] `.

Example:

```text
[PRD][History] Ride export
```

Keep titles short: prefixes plus a 2-5 word noun phrase.

## Implementation issues

When publishing implementation issues from a PRD, keep the same area prefix and include the approved slice number:

```text
[<Area>] <number> - <Short verb phrase>
```

Example:

```text
[History] 1 - Export ride file
```

Use the slice number from the approved breakdown, not the GitHub issue number. Publish dependent issues sequentially so blocker references use real issue numbers.

Include a `## Likely files` section in each implementation issue. List repo-relative paths that are probably useful starting points for an AFK agent, with one short reason per path:

```markdown
## Likely files

- `src/tune/readConfig.ts` - existing tune config read flow
- `modules/vesc-native/ios/VescNativeModule.swift` - native VESC bridge entrypoint
```

Treat these as navigational hints, not a complete file list or ownership boundary. Keep the section small, normally 3-8 paths. Use codebase evidence from local exploration; if the relevant files cannot be narrowed confidently, say what area to inspect first instead of inventing paths.

## App-area labels

Use one or more app-area labels for filtering:

| Area label         | Title prefix    | Use for                                                                                                                     |
| ------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `area:history`     | `[History]`     | ride history, sessions, buckets, graphs                                                                                     |
| `area:sanitizers`  | `[Sanitizers]`  | metric sanitizers and exclusions                                                                                            |
| `area:map`         | `[Map]`         | maps, routes, GPS display                                                                                                   |
| `area:weather`     | `[Weather]`     | weather data and UI                                                                                                         |
| `area:core`        | `[Core]`        | app shell, storage, lifecycle, infra                                                                                        |
| `area:server`      | `[Server]`      | Vescape backend APIs, relay behavior, server policy, and deployment-facing contracts                                        |
| `area:board`       | `[Board]`       | board profiles, board table/settings                                                                                        |
| `area:telemetry`   | `[Telemetry]`   | live telemetry ingest/display                                                                                               |
| `area:tunes`       | `[Tunes]`       | VESC tune read/write flows                                                                                                  |
| `area:alerts`      | `[Alerts]`      | alert rules, alert feedback, audio/TTS                                                                                      |
| `area:battery`     | `[Battery]`     | battery config, SoC estimation, voltage compensation                                                                        |
| `area:tech`        | `[Tech]`        | internal refactor, tech upgrades, no user-visible behavior change                                                           |
| `area:design`      | `[Design]`      | design system, theme, color tokens, and visual conventions                                                                  |
| `area:ios`         | `[iOS]`         | iOS-only work: the iOS platform port and iOS-specific native code. Not for cross-platform work that merely also touches iOS |
| `area:watch`       | `[Watch]`       | Watch Mirror — live telemetry on the wrist and alert playback, Wear OS / watchOS companions                                 |
| `area:group-ride`  | `[GroupRide]`   | Group Rides — live shared rides, Rider presence, nearby discovery, relay server, social panel                               |
| `area:legal-mode`  | `[Legal Mode]`  | Legal Mode UI, jurisdiction speed defaults, speed-warning alerts, and legal board constraints                               |
| `area:warnings`    | `[Warnings]`    | Board Warnings — native fault-code detection, warning registry, rider-facing warning surface                                |
| `area:diagnostics` | `[Diagnostics]` | Debug Recordings, replay tooling, Diagnostic Events, dev-mode debugging surfaces                                            |
| `area:sync`        | `[Sync]`        | Backup sync — native uploader, Sync Cursors, Sync Actions, Device Token, backup status                                      |
| `area:auth`        | `[Auth]`        | Clerk sessions, native Device Tokens, credential lifecycle, and endpoint caller policy                                      |
| `area:release`     | `[Release]`     | release automation, Play tracks, versioning, release notes, and GitHub Releases                                             |
| `area:assets`      | `[Assets]`      | hosted media, image normalization, upload state, and remote Asset references                                                |
| `area:e2e`         | `[E2E]`         | Maestro E2E flows, screenshot capture tooling, device fixtures and presets                                                  |
| `area:navigation`  | `[Navigation]`  | Navigation — path to a Direction Point, Navigation Profile, and the rider-facing route line                                 |
| `area:pin-lock`    | `[PIN Lock]`    | VESC PIN write-lock: capability probe, PIN on Board Link, unlock-wrapped firmware commands                                  |

When a PRD or issue-planning skill creates or starts using a new app-area label, update this table in the same turn. Add the label, title prefix, and a short "Use for" description so future PRDs and implementation issues can reuse the prefix consistently.

If a user writes a typo for a known area, normalize it in metadata. For example, use `area:sanitizers` and `[Sanitizers]` for `sanatizers`.

## Complexity labels

Every implementation issue must have exactly one complexity label. Complexity reflects **risk and precision needed**, not size. A 5-line native pipeline change can be `complexity:high`; a 100-line UI component can be `complexity:low`.

| Label               | When to use                                                          | Claude         | OpenAI        |
| ------------------- | -------------------------------------------------------------------- | -------------- | ------------- |
| `complexity:low`    | Isolated changes, hard to break other things (UI, docs, config)      | sonnet / haiku | GPT-5.3 Codex |
| `complexity:medium` | Moderate integration surface, needs care but not safety-critical     | sonnet         | GPT-5.4 Codex |
| `complexity:high`   | Critical paths, subtle correctness, native pipelines, data integrity | opus           | GPT-5.5       |

## When a skill says "fetch the relevant ticket"

Run:

```bash
gh issue view <number> --json number,title,body,state,labels,assignees,comments,url --jq '.'
```

Do not use unauthenticated HTTP requests or browser scraping for GitHub issue content. Do not treat empty output from plain `gh issue view --comments` as an empty issue; retry with JSON.

## When implementing an issue

1. Fetch the issue with `gh issue view <number> --json number,title,body,state,labels,assignees,comments,url --jq '.'`.
2. Use local files in the checked-out repo for code and docs.
3. Use `gh issue comment <number> --body "..."` for implementation notes when needed.
4. Never rely on public GitHub HTTP URLs for issue or repository contents; this repo is private.
