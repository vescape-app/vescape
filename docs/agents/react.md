# React Native

React Native UI conventions for this repo. Add component, styling, navigation, animation, and Expo Router guidance here when it becomes stable enough to apply across the app.

For visual design principles (colors, layout, typography, when to use cards), see [`docs/design.md`](../design.md).

## Colors

Every color must come from the `theme` object in `src/constants/theme.ts`. Never hardcode a hex or rgba value directly in a component.

Use `theme.neutral` for the white/read-only canvas, separators, and neutral copy. Use `theme.control` for interactive surfaces and their foregrounds. Use `theme.palette.<hue>` for adaptive accent text, icons, borders, and small tinted states rendered by React Native. Metric visuals use `theme.telemetry`. Raw `theme.palette.slate` values are fixed dark swatches for map JSON and other non-adaptive assets.

When adding or changing a color, choose its role first: neutral content, navy control, accent, telemetry, or fixed map/chart visual. `theme.palette.slate` is never a shortcut for a dark-looking UI border or surface. Check the edited component in both appearances, including a light → dark switch while it stays mounted.

For a separator, border, or surface that changes with the rider's theme, read the resolved palette inside the component and apply the color in render. A `StyleSheet.create` entry is created once; an iOS native dynamic color captured there can retain the previous forced appearance after a switch. In particular, compute `theme.alpha(neutral.border, 0.6)` from `useResolvedNeutralColors()` during render, rather than storing `theme.alpha(theme.neutral.border, 0.6)` in a static style. Keep geometry in `StyleSheet.create`.

Run `bun run theme:colors:check` as soon as a color edit is in place. It rejects raw hex/rgb/hsl literals outside the palette and reviewed fixed map-style files, new fixed-dark slate swatches, and the known static divider pattern. Use `transparent` only to mean no paint. Run `bun run ts` when changing the boundary between native color objects and string-only renderers. The checker covers color sourcing and those patterns; visual verification covers token choice, contrast, and mounted transitions.

The adaptive neutral, control, accent, and telemetry tokens are native color objects at runtime. Mapbox, Skia, Reanimated worklets, and string-valued state/options cannot consume them. Use the corresponding hooks from `src/hooks/useTheme.ts`: `useResolvedNeutralColors()`, `useResolvedControlColors()`, `useResolvedAccentColors()`, and `useResolvedTelemetryColors()`. Pass only their plain string values into the renderer or data structure.

Type native-facing color props as `ThemeColor`; keep renderer inputs and persisted colors typed as `string`. Resolve individual tokens with `useResolvedColor`, or `resolveAdaptiveColor(color, appearance)` outside React. Resolve before building color-based grouping keys, too. Casting a token to `string` bypasses this boundary without converting its runtime value.

`theme.native.test.ts` exercises native-shaped Android/iOS colors in isolated processes, since the normal test preload uses strings. Its type assertions also prevent adaptive tokens from becoming string-compatible again. The Phosphor patch widens its native SVG color props to React Native's `ColorValue`; renderer props must retain their string-only contract. For Android rendering coverage, use the component-library smoke flow documented in `e2e/README.md`.

Filled actions use the resolved hue's `solid` background and `onSolid` content pair. Do not infer the foreground from `color`, `text`, or a fixed black/white value; the pair is contrast-checked separately for each appearance.

```tsx
import { theme } from '@/constants/theme'

// ✅ Good
backgroundColor: theme.control.background,
color: theme.telemetry.speed,

// ❌ Bad
backgroundColor: '#1e293b',
color: '#38bdf8',
```

## No barrel files

Do not create `index.ts` barrel files under `src/components/` or any of its subdirectories.

- Import components directly from their source file: `import { Foo } from '@/components/Foo'` or `import { Foo } from '@/components/settings/Foo'`.
- Barrel files add indirection, slow down TypeScript resolution, and create merge conflicts when multiple agents touch the same index file.

## Component Gallery

When creating or significantly changing a reusable UI component, add or update its showcase under
`src/app/settings/components/` (`index.tsx` registers the screens) in the same change.

- When asked to create a component, create a real component file under `src/components/` or the
  appropriate subdirectory such as `src/components/settings/`. Do not hide reusable UI as a
  function at the top of a screen file.
- Use existing `ShowcaseCard` and controls from `@/components/dev/ShowcaseControls`.
- Include useful variants, states, and props that future agents/design checks need to see.
- Keep showcase data local and deterministic enough for quick visual inspection.
- Skip only components that are route-specific screens or tiny private sub-components with no reuse surface.

## Icons

Use **`phosphor-react-native`** for all icons. Do **not** use emoji or unicode characters as icon substitutes.

- Always use the **`Icon`-suffixed** export, for example `LightningIcon`, not `Lightning`. The un-suffixed names are deprecated and will produce warnings.
- The `type Icon` export for typing icon props is **not** suffixed; import it as `type Icon` as-is.

## Core UI primitives

Use the shared primitives rather than ad-hoc `Pressable` or OS dialogs (read each component's props directly):

- **`Button`** (`@/components/Button`) — all tappable button actions; keep `style` to layout only.
- **`IconButton`** (`@/components/IconButton`) — all circular icon-only pressables.
- **`ConfirmModal`** (`@/components/ConfirmModal`) — all confirmation prompts; never use `Alert.alert`.
- **`Switch`** (`@/components/controls/Switch`) — every boolean toggle (React Native's `Switch` is unused):
  - `value: boolean | null` (`null` rests the thumb in the centre when state is unknown).
  - Prefer `pending` over `disabled` for an in-flight write: `disabled` means "you may not", `pending` means "wait" (centres and spins the thumb until the owner answers).
  - Inside a pressable row, wrap `Switch` in `<View pointerEvents="none">` so the row owns the tap.
  - Inherits `SettingsRow`'s `iconColor` (or `SwitchAccentProvider`) automatically.
- **`RadioIndicator`** (`@/components/controls/RadioIndicator`) — one-of-several choices on a pressable row.

## High-frequency live streams

Any source faster than a few Hz (telemetry, GPS, magnetometer/heading, Group Ride presence) **must not** call `setState` or bump a Zustand slice per sample:

- Route hot display values to Reanimated SharedValues (`src/modules/board/lib/liveTelemetryRuntime.ts`) and publish a coalesced cold snapshot at ~1 Hz (`LIVE_HISTORY_PUBLISH_MS = 1000`) for components that must re-render.
- Read natively decimated (`onLiveSeries`) or focused (`onFocusedSeries`) series rather than projecting raw buffers or storing projected arrays in Zustand.
- Never mix `useSyncExternalStore` with Zustand for the same publish cycle — it triggers synchronous double renders outside React batching.
- Keep screen subtrees under ~5 renders/second. Wire the dev-only canary `useRenderRateWarning` (`src/hooks/useRenderRateWarning.ts`) at stream boundaries (`MainMap`, `BottomTelemetryStrip`, `GroupRideWidget`).
- Never trust dev-mode JS profiling numbers — React DevTools adds 40–50% overhead; always verify perf issues in Release builds (`bun run android:release` or iOS Release).
