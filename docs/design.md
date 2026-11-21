# Design Language

Visual design principles for the Vescape app. Follow these when building or modifying UI.

> **Every color in the app must come from the `theme` object in `src/constants/theme.ts`.**
> Never hardcode a hex value (`#...`), rgba literal, or any color string directly in a component file.
> If you need a new color, add a token to `theme.ts` first — then use it everywhere via `theme.*`.

> **No large solid bright fills — anywhere in the app.**
> Bright accent colours (`theme.*.color`) are for **thin borders, icons, and text**, not for filling large areas. Avoid `weight="fill"` glyphs, bright filled discs/badges/blocks, and bright-coloured backgrounds behind content. State and emphasis come from thin borders + coloured icons/text on the dark surface.
> Permitted fills: neutral surfaces (`theme.neutral.surface`/`surfaceDeep`), tinted pill backgrounds (`theme.*.bg`), and the primary `Button`. Small bright accents (a thin underline, a dot, a 1–2px border) are fine; large bright planes are not.

## Theme

The app has adaptive light and dark appearances. The durable `themeMode` setting supports:

- `system` (default) — follows the phone appearance.
- `light` — always light.
- `dark` — always dark.
- `sun` — light between local sunrise and sunset, dark otherwise, using the current or last known GPS location. It falls back to the system appearance when no location is available.

App theme and map style are independent preferences. Selecting a map never changes `themeMode`. The Streets option renders One Dark in dark appearance and Outdoors in light appearance, including System and Sunrise & sunset transitions. Existing saved `onedark` and `outdoors` selections both represent Streets; theme changes do not rewrite the saved map choice. Satellite and Mapy.cz remain selected across appearance changes.

Neutral UI colors come from `theme.neutral`, while accent UI colors come from `theme.palette.<hue>`. Both are backed by iOS dynamic colors and Android day/night resources. For surfaces and separators that must track an in-app appearance switch while mounted, resolve the color during render with the hooks in `src/hooks/useTheme.ts`; a native color held in a static `StyleSheet.create` entry can retain the previous forced appearance on iOS. `theme.palette.slate` remains a raw dark swatch for fixed dark map styles; do not use it for app surfaces or text.

The light appearance uses a pure-white canvas. Read-only content sits directly on that canvas and is separated with spacing, typography, or thin neutral rules rather than raised cards. Interactive controls use the dark navy `theme.control` family in both appearances — the same `#0f172a` base in light and dark — making affordances obvious without shadows and keeping the accent-colored actions legible. Dark-contrasted chrome must use the adaptive `theme.control.*` family (or `theme.neutral.*` for content surfaces) — never the fixed `theme.palette.slate.*` raw swatches, which stay near-black in both appearances and are reserved for on-map/chart graphics.

Segmented controls that use the `lightTabs` variant flip their contrast in light mode: the track stays navy and the active segment becomes a white pill with an accent border and accent text/icon; inactive segments are transparent with muted control text. Colored actions — `Button` accent/tune/success/destructive/groupRide, `IconButton` destructive/accent, the map-sheet primary `Ride it` / `Navigate` and `Cancel`, and map-sheet delete/save/vote buttons — carry their identity in the accent: on dark the accent tints the surface beneath (`coloredAction.darkTint`, dev's tinted pill); on light the accent washes over the navy control surface (`coloredAction.tint`) so a colored action keeps the weight of a filled control without a new palette color. They always use colored text and border, never white-on-navy or a bright translucent fill alone.

Telemetry colors are appearance-specific. The light variants are darker than their dark-appearance counterparts so gauges, charts, routes, and small labels retain contrast against white. Use `theme.telemetry` for React Native styles and `useResolvedTelemetryColors()` for renderers.

Non-React-Native renderers and worklets use the plain-string palettes from `useResolvedNeutralColors()` and `useResolvedAccentColors()`; native adaptive color objects must not cross into Mapbox, Skia, Reanimated worklets, or string-valued state.

Android native `Switch` color props also receive resolved string colors. Its native color converter does not reliably resolve the adaptive resource-path value used by the rest of the React Native style system.

Satellite follows the effective app appearance with a navy backdrop in dark mode and a light backdrop in light mode. Home and Explore retain independent imagery-opacity preferences.

## Layout Principles

- **No decorative boxes or elevation.** Cards wrap only interactive groups (rows with inputs, switches, buttons). Do not wrap static info or labels in bordered containers, and do not use shadows to make hierarchy.
- **Flat rows.** Settings-style rows are icon + label + control, no background box around the icon.
- **Breathing room.** Use padding and gap, not borders, to separate content sections.
- **Section titles** are uppercase, small (`12–13px`), muted (`theme.neutral.textMuted`), with letter-spacing.

## Semantic Colors

All token names and swatches live in `src/constants/theme.ts` (`neutral`, `control`, `palette`, `telemetry`, `map`, `status`, `tune`). Selection rules:

- **`theme.neutral` vs `theme.control`:** read-only surfaces/borders/copy use `theme.neutral.*` (neutral row icons use `theme.neutral.textSecondary`); interactive surfaces and their foregrounds use `theme.control.*`. Never use fixed-dark `theme.palette.slate` for app UI.
- **`theme.palette.<hue>`:** use `.color` for icons/thin borders, `.text` for foreground text, `.bg`/`.border` for tinted pills, and the contrast-checked `.solid`/`.onSolid` pair for filled buttons — never place a guessed black/white label over an accent fill. `theme.tune` aliases purple for Tune Profile actions.
- **`theme.telemetry` / `theme.status` / `theme.map`:** use domain tokens instead of picking raw palette hues so metrics and states stay consistent and contrast-safe across appearances.
- **`theme.alpha(color, level)`:** every translucent value must go through `theme.alpha(...)` with its typed `AlphaLevel`, never hand-written `rgba(...)`.

## Icons

Use `phosphor-react-native` with `weight="duotone"` as default weight. Each icon gets a distinct accent color from `theme` — do not reuse the same color for adjacent icons.

Board Warnings use `EngineIcon` everywhere. VESC faults use `WarningDiamondIcon` with
`theme.status.caution`, the yellow status palette. The Edit Board battery entry uses
`theme.settingsIcon.battery`, green. Yellow in these controls is reserved for warnings and alerts.
Empty-state placeholders, including "No faults" and "No warnings", use the default gray
`theme.neutral.textMuted` icon, not the feature's warning accent.

Icon sizing:

- `14` — inline metadata, header stats
- `16–18` — row icons in settings/lists
- `20` — row icons inside icon boxes (legacy card rows)

## Status & Selection Indicators

A specific application of the no-bright-fills rule. Status and selection states (checklist steps, radios, progress milestones) use **thin-bordered outline circles**:

- Wrap the indicator in a generous circle (`40–44px`, `borderWidth: 1.5`, transparent background). State is carried by the **thin border colour + the icon colour**, both from `theme.*` — done in `gps`, active in `wheel`, error in `error`, idle in `theme.neutral.border`/`textMuted`.
- Never a `weight="fill"` disc or filled dot — a bright filled glyph reads as a heavy blob on the dark surface.
- **Bigger is calmer.** Prefer large outline circles with breathing room over small dense glyphs.

## Cards

Use cards (`backgroundColor: theme.neutral.surface`, `borderRadius: 12`, `borderColor: theme.neutral.border`) only for grouping interactive elements (switches, steppers, pressable rows). A card groups related controls — not labels or read-only info.

Inside cards, separate rows with a thin `theme.neutral.border` line indented past the icon (`marginLeft: 58`).

**Corner sheets (EdgeDrawer) in light theme use a translucent white body** — free-floating fields on that surface read as unfinished. Group a sheet's interactive content in the same card boxes used on the settings screens (`SettingsCard`), with the sheet's mode switch (e.g. tab pills) and primary action sitting outside the card.

## Info Headers

For screen headers showing metadata (version, OS, DB size), use centered text without card wrappers:

- App name large and bold
- Stats in a horizontal row with colored icons + small muted text
- No background, no border — sits directly on screen background

## Typography

The app's UI font is **Raleway**, shipped as official static per-weight files (`assets/fonts/Raleway-300.ttf` … `Raleway-900.ttf`) and loaded in `src/app/_layout.tsx` via `expo-font`'s `useFonts` before the `Stack` mounts. The splash stays visible until the fonts are ready on cold start. Static files with correct embedded family, style, and PostScript names are required: Android does not move a custom variable font's `wght` axis, while iOS relies on the embedded names to distinguish registered faces. Raleway defaults to old-style figures, so the shared `Text` wrapper enforces the OpenType `lining-nums` variant.

Every `Text` instance renders through the wrapper at `src/components/base/Text.tsx`, which reads `fontWeight` from the style and resolves it to the matching family via `theme.font(weight)` (default `'500'` — Raleway 400 reads too thin on the dark surface). Import `Text` from `@/components/base/Text` — never import `Text` from `react-native` directly for UI text.

- `theme.font(weight)` in `src/constants/theme.ts` is the single source of truth for per-file aliases (`'Raleway-500'` etc.). Components keep writing plain `fontWeight: '600'` and rely on the wrapper; never inline `'Raleway…'` in a component or style.
- Numeric readouts **opt out** of Raleway and use **JetBrains Mono** (`assets/fonts/JetBrainsMono-500.ttf` … `-800.ttf`, weights 500/600/700/800), via `theme.mono(weight)`. The platform `fontFamily: 'monospace'` alias is still used for developer-facing text (event log, raw settings) where the exact face does not matter; anything a rider reads at speed uses the bundled family so digit advance is identical on both platforms.
- Live values (anything driven by a shared value rather than a React render) go through `MonoValue` / `TickText` in `src/components/base/`, which draw on Skia. Never render a live value into a non-editable `TextInput` through `animatedProps` — a test in `src/components/base/liveReadouts.test.ts` fails if that pattern comes back.
- Every canvas is a separate native surface, so do not mount one per readout. When the parent already draws on Skia, put a **`MonoText`** node in that canvas instead of a `MonoValue` — that is how the gauges draw their value and unit, and how `BmsCellVoltages` fits every cell row onto one canvas. `MonoValue` is `MonoText` plus a canvas, for readouts that sit on plain views.
- Bars and indicators driven by live values belong on the same canvas as the numbers. An animated percentage `width` is a layout prop: it runs a Yoga pass per frame per row, which is what the cell rows used to do.
- A Skia canvas does **not** grow to fit its text the way a `Text`/`TextInput` box does. Give `MonoValue` a `width`, or a parent with a definite width plus `alignSelf: 'stretch'`, or the readout collapses or clips. Canvases drawn at a measured size use `useCanvasSize` on a host view (`onLayout` is unsupported on a Fabric canvas).
- Stack header titles (and any style fed to a native component that bypasses the wrapper) must set `fontFamily: theme.font('600')` explicitly — see `src/app/_layout.tsx` `headerTitleStyle` — and must not set `fontWeight`.
- `fontVariant: ['tabular-nums']` still aligns numeric columns on Raleway.

Watch companions use the same bundled families: Raleway for labels and JetBrains Mono for numeric readouts. Their native typography helpers keep watch-specific sizes; system symbols and the watchOS system clock keep the platform font. Watch targets reuse `assets/fonts/` rather than maintaining separate font files.

Typography roles:

| Role          | Size  | Weight | Token                         |
| ------------- | ----- | ------ | ----------------------------- |
| Screen title  | 20    | 700    | `theme.neutral.textPrimary`   |
| Row label     | 15    | 600    | `theme.neutral.textPrimary`   |
| Row hint      | 12    | 500    | `theme.neutral.textMuted`     |
| Section title | 12–13 | 700    | `theme.neutral.textMuted`     |
| Metadata      | 12    | 500    | `theme.neutral.textSecondary` |
| Stepper value | 15    | 700    | `theme.neutral.textPrimary`   |

Preview every role live under **Settings → Components → Typography** (`src/app/settings/components/typography.tsx`).

> Raleway reads thinner than the platform default font, so the design system starts body text at `500` (Medium). Any `Text` without an explicit `fontWeight` resolves to `500` — see the wrapper at `src/components/base/Text.tsx`. Use `'400'` only when a deliberately thin label is intended (e.g. quiet chart axis ticks). Screens that need older behavior can pass `fontWeight: '400'` explicitly.

## Avoid

- Wrapping non-interactive content in cards or bordered boxes
- Using the same icon color for adjacent items
- Solid bright fills for status/selection (filled check discs, `weight="fill"` dots) — use thin-bordered outline circles instead
- `Alert.alert` — use `ConfirmModal` instead
- Ad-hoc `Pressable` + `Text` — use `Button` or `IconButton`
- Emoji or unicode as icon substitutes
