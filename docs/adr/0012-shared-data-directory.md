# Shared data directory

Data and assets used by both JS and native (Android/iOS) live in `shared/` at the project root. JS imports files directly (Metro resolves them at bundle time). Native platforms receive copies via `bun run copy:shared`, which places files into platform-specific locations (Android assets; iOS bundle resources).

## Structure

- `shared/data/` — JSON data files (cell presets, future config). Copied to `android/src/main/assets/data/` and `android/src/test/resources/data/`.
- `shared/alerts/packs/` — Generated alert sound packs. Effects packs are copied, keeping their folder layout, to `android/src/main/assets/alert-packs/` and `ios/alert-packs/` (bundled as a folder).

Copied targets are gitignored — `shared/` is the source of truth.

## Considered Options

- **Duplicate data per platform.** Rejected: cell preset list was already duplicated between JS and Kotlin, causing drift risk. More shared data is expected (SoC curves, future config).
- **Kotlin Multiplatform shared module.** Rejected: KMP build complexity not justified for static data. JSON is universally parseable.
- **Symlinks into platform dirs.** Rejected: fragile across platforms, Xcode doesn't follow symlinks into bundle resources. Copy script is explicit and consistent with prior `copy:alert-sounds` pattern.
- **Gradle `assets.srcDirs` / Xcode build phase.** Considered but copy script is simpler, already proven, and works identically for both data and audio assets.

## Consequences

- `bun run copy:shared` must run before Android builds and tests. Add to CI build steps.
- Adding a new shared file: put it in the appropriate `shared/` subdirectory, extend `scripts/copy-shared.ts` targets if a new destination is needed.
- Native code that consumes shared JSON needs platform asset-loading (Android `context.assets`, iOS `Bundle.main`). Parsing happens at init time, not per-frame.
