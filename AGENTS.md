# Agent Guidelines

## Package Manager

Always use **bun** for all package management and script execution:

- Install dependencies: `bun install`
- Add packages: `bun add <package>`
- Remove packages: `bun remove <package>`
- Run scripts: `bun run <script>`
- Execute binaries: `bunx <binary>`
- Run tests: `bun test`

Do **not** use `npm`, `yarn`, `npx`, or `pnpm`.

## Formatter

Use **Oxfmt** (`bun run format`) for repository formatting. Do not run Prettier or
apply Prettier-formatted rewrites; Prettier rewrites the style globally and causes
`Formatter mismatch caught: Prettier rewrote style globally`.

## Verification Budget

Lefthook `pre-commit` already runs fmt, `ts`, lint, knip, and tests on staged files. Don't
re-run `bun run check` after every edit — wasteful.

- Big refactor, rename, move, deletion → `bun run ts` (+ `bun knip` after deletions).
- Real logic change with tests → `bun test <path>`, that path only.
- Check failed → re-run that one check until green.
- Small edits (copy, style, props, docs) → nothing, let the hook catch it.

Narrow command over full `bun run check`.

## Git Branch Names

Do **not** add generated prefixes to branch names, including agent/tool names like `codex/`,
`claude/`, `agent/`, or similar.

- Use clean feature branch names, e.g. `battery-bms-diagnostics`.
- Only add a prefix when the user explicitly asks for that exact prefix.

## Environment Fixes

Do not fix local machine, shell, PATH, Java, Android SDK, Maestro, or other CLI/tooling environment problems in project code, package scripts, Expo config, or source files.

- Fix user or agent environment files instead, such as shell rc/profile files.
- Keep project scripts portable and free of machine-specific paths.
- If a tool is missing from non-interactive shells, repair the shell/agent environment, not `package.json`.

## Architecture Discipline

This is a PoC, but keep it sharp:

- Native owns durable truth and long-lived work; JS renders state and sends intents.
- Prefer clear architecture over compatibility, shortcuts, or hidden assumptions.
- Remove unused code! Not keep dead code for later.
- No duplicate code! We do not want to repeat ourselves.
- Do not add tests for trivial predicates. Add tests for meaningful behavior, edge cases, contracts, or regressions.
- New Board Warning detectors must add their kind to `docs/board-warnings.md` (the kinds catalog) alongside the `BoardWarningKind` slug.

## Parity

`@parity` links code that must stay in sync across implementations. It is a navigation contract: a tag is a
promise that the peer is inspected before the edit is finished.

Format: `@parity /repo-root/path-to-peer`, optionally suffixed with a backtick-quoted symbol name when the
link is narrower than the whole file:

```
@parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt
@parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `frontendActive`
```

### Native ↔ native (iOS ↔ Android)

When both platforms implement the same capability, tag both sides — the pair is bidirectional.

- Tag near the module/class/function entry point on both platform implementations.
- Keep native API, event names, payload shapes, errors, lifecycle, threading, persistence, and unsupported-platform behavior aligned.
- Use `@platform-diff <reason>` next to the `@parity` tag only for intentional, accepted long-term platform differences.
- Do not add `@parity` to Expo-generated `android/` or `ios/` root folders; use durable source under `modules/`, config plugins, or shared source inputs.
- If parity cannot be completed now, leave a `TODO(<platform> parity): <reason>`, create/follow an issue, and call out the limitation in the final response.

### TS ↔ native

TS that mirrors a native contract carries the same tag. This makes the link a triangle: TS points to both
platforms, and each platform points back to the TS peer.

Tag TS when it duplicates a native definition:

- Enums and union types mirroring native enums.
- Event names and payload/prop types crossing the bridge.
- Contract constants (keys, limits, defaults, thresholds) that native also hardcodes.
- Small logic that native re-implements (formatting, thresholds, derivations).

Rules:

- A TS node mirroring both platforms carries two `@parity` lines — one per platform.
- Back-pointers to TS belong only on the native nodes the TS actually mirrors. Do not tag native implementation internals with a TS pointer; they have no TS peer.
- No tag when there is only one definition: values passed to native at runtime, or JS-only presentation (titles, colors, formatting) native never defines. Tag the shape/keys of what crosses the bridge, not the values.
- Shared key constants (settings keys, payload keys) are covered by the container-level tag on the type/interface/file that defines them — do not tag individual string literals.
- `@platform-diff` and `TODO(<platform> parity)` apply here identically.

## Dir layout

- `modules/vescape-core/` — the core of the app: ~50% of all code (Swift + Kotlin, roughly equal to all of `src/`). Durable native source, owns BLE transport, board session, telemetry, recording, alerts, and Refloat config. `ios/` and `android/` subtrees are peer implementations linked by `@parity`. Treat it as a first-class part of the codebase, not a native detail hanging off the JS app.
- `android/`, `ios/` — Expo-generated native folders. They are gitignored and not durable source; do not make lasting changes there. Update Expo config, modules, plugins, or source inputs instead.
- `src/modules/<feature>/` — domain code, one folder per bounded context (`board`, `battery`, `tune`, `map`, `history`, `alerts`, `weather`, `group-ride`, `settings`, `diagnostics`, `profile`, `legal`). Each module colocates its own `lib/` (pure logic), `store/` (Zustand), `hooks/`, `components/`, `constants/`, and optionally `screens/`. If code names a domain concept, it lives here. Cross-module imports are restricted to the allowlist ratchet in `src/modules/moduleBoundaries.test.ts` — do not add edges without strong reason; multi-module cooperation belongs in `src/screens/` or `src/app/` composition.
- `src/components/` — domain-less UI kit only (`base`, `forms`, `modals`, `charts`, `controls`, `gestures`, `overlays`, `settings` primitives, `dev`, `widgets`). If a component imports domain code, it belongs in a module.
- `src/helpers/` — Single-source pure utilities (finite, id, error, format).
- `src/hooks/` — Generic React hooks only (no domain imports).
- `src/screens/` — Multi-module screen composition. No single-domain screens, no pure domain logic.
- `src/bootstrap/` — App-root wiring run once at startup (native→JS data sync).
- `src/app/` — Expo Router routes only. Thin re-exports from modules/screens.
- `src/constants/` — `theme.ts` only. `src/config/`, `src/navigation/` — static defs.

## React Native

React Native UI conventions, including icon usage, live in `docs/agents/react.md`.
Skia canvas rules — gesture frame cost, transform-only animation, worklet and repaint traps — live in `docs/agents/skia.md`.
Visual design language (colors, layout, typography) lives in `docs/design.md`.
Clerk production authentication setup and Android email-link debugging live in `docs/agents/clerk-auth.md`.
Mapbox dependency patches and their native camera semantics live in `docs/agents/mapbox-patches.md`.
Generated native state (`ios/`, `android/`, Pods) is kept in sync by `bun run ios` / `bun run android`; see `docs/agents/native-sync.md`.

When adding or changing a reusable UI component (or a new visual variant/state of one), add or update its preview in the component showcase under `src/app/settings/components/` so every component stays browsable with live controls.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `vescape-app/vescape`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo with root `CONTEXT.md` and root `docs/adr/`. See `docs/agents/domain.md`.
