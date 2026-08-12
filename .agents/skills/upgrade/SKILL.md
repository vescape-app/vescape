---
name: upgrade
description: Safely upgrade Vescape dependencies, repair dependency/cache/native drift, validate builds, and preserve reusable upgrade lessons. Use when the user invokes `/upgrade`, asks to update packages, upgrade Expo or React Native, or diagnose failures caused by a dependency update.
---

# Upgrade

Safely update dependencies. Caveman comms: exact package/version/error/command.

## Scope

- Default to compatible patch updates. No SDK, major, preview, or broad pre-1.0 minor jumps without explicit approval.
- Use `bun`/`bunx` only. Never npm, npx, yarn, or pnpm.
- Preserve user changes. Inspect `git status`, package manifests, lockfile, Expo exclusions, and `patches/` first.
- Read `.agents/skills/upgrading-expo/SKILL.md` when Expo, React Native, Reanimated, Worklets, Router, or native modules move.

## Workflow

1. Inventory with `bun outdated` and `bunx expo install --check`.
2. Choose a small compatible set. State updates and intentional skips before mutation.
3. Use `bunx expo install --fix` for Expo-managed versions. Expo packages normally use `~`; tightly coupled native packages may be exact.
4. Use `bun add` for selected non-Expo packages. Review `package.json` and `bun.lock`; reject surprise transitive or range changes.
5. Run `bunx expo install --check` again.
6. Audit existing patches against the new installed source. Never port an upstream patch blindly.
7. Reset generated/runtime state described below.
8. Run validation. If `/pr` was requested, follow `.agents/skills/pr/SKILL.md`, push, and wait for CI.

## Install integrity before patching

Bun's incremental hoisted layout can temporarily differ from the lockfile. Before patching an upstream package for an impossible API/version mismatch:

1. Compare its declared dependency, `bun.lock`, `require.resolve(...)`, and actual nested `node_modules`.
2. Run `bun install --force` to reconstruct the layout.
3. Test pristine upstream code in the real CLI/Gradle path.
4. Patch only a reproducible upstream defect. Remove obsolete patches from `package.json`, `bun.lock`, and `patches/`.

Known lesson: Expo autolinking declares its own Commander version. A missing nested copy made it resolve React Native's hoisted Commander and falsely look patch-worthy.

## Metro and transform caches

After updating Expo Router, Babel/Metro, Reanimated, Worklets, or packages shipping transformed worklets:

1. Stop the existing Metro process; disk clearing does not replace its in-memory cache.
2. Restart with `bun run start --clear`.
3. Reload the app.

For `Worklets` JS/plugin mismatch, inspect the offending transform's `__pluginVersion`. A cached old plugin version means clear Metro; do not change app source. If the error instead says JS/native mismatch, rebuild the native app.

## Native state

- Native dependency/config-plugin change: run the repo's `bun run native:sync <platform>` or `bun run ios` / `bun run android`; do not hand-edit generated `ios/` or `android/`.
- iOS build needs signing/device environment. Report missing environment honestly; do not encode machine fixes in project files.
- Sentry upload is not compilation. For local release-build proof without credentials: `SENTRY_DISABLE_AUTO_UPLOAD=true bun run build:release`.

## Validation

Minimum:

```bash
bunx expo install --check
bun run check:ci
SENTRY_DISABLE_AUTO_UPLOAD=true bun run build:release
```

Also exercise the affected platform/runtime. Dependency checks and compilation do not prove a cached development session works.

## Keep this skill alive

When an upgrade reveals a verified, reusable caveat:

- Add the shortest prevention/diagnosis rule here in the same branch.
- Include trigger, distinguishing evidence, and correct recovery.
- Do not add project history, package-version trivia, or an unproven workaround.
- Keep `SKILL.md` under 100 lines; split stable detail into one-level references if needed.
