# Design Language

Visual design principles for the Vescape app. Follow these when building or modifying UI.

> **Every color in the app must come from the `theme` object in `src/constants/theme.ts`.**
> Never hardcode a hex value (`#...`), rgba literal, or any color string directly in a component file.
> If you need a new color, add a token to `theme.ts` first — then use it everywhere via `theme.*`.

> **No large solid bright fills — anywhere in the app.**
> Bright accent colours (`theme.*.color`) are for **thin borders, icons, and text**, not for filling large areas. Avoid `weight="fill"` glyphs, bright filled discs/badges/blocks, and bright-coloured backgrounds behind content. State and emphasis come from thin borders + coloured icons/text on the dark surface.
> Permitted fills: dark surfaces (`theme.neutral.surface`/`surfaceDeep`), dark tinted pill backgrounds (`theme.*.bg`), and the primary `Button`. Small bright accents (a thin underline, a dot, a 1–2px border) are fine; large bright planes are not.

## Theme

Dark-first. All screens use dark backgrounds with light text.

| Role           | Token                               |
| -------------- | ----------------------------------- |
| Background     | `theme.palette.slate.bg`            |
| Card / surface | `theme.palette.slate.surface`       |
| Deep surface   | `theme.palette.slate.surfaceDeep`   |
| Border         | `theme.palette.slate.border`        |
| Primary text   | `theme.palette.slate.textPrimary`   |
| Secondary text | `theme.palette.slate.textSecondary` |
| Muted text     | `theme.palette.slate.textMuted`     |
| Dim text       | `theme.palette.slate.textDim`       |

## Layout Principles

- **No decorative boxes.** Cards wrap only interactive groups (rows with inputs, switches, buttons). Do not wrap static info or labels in bordered containers.
- **Flat rows.** Settings-style rows are icon + label + control, no background box around the icon.
- **Breathing room.** Use padding and gap, not borders, to separate content sections.
- **Section titles** are uppercase, small (`12–13px`), muted (`theme.neutral.textMuted`), with letter-spacing.

## Semantic Colors

Use `src/constants/theme.ts` for all accent colors. Never hardcode a hex value, `rgba(...)` literal, or any color string directly in a component.

`theme.tune` aliases the purple palette for Tune Profile actions and entry points.

The theme is organized into domains:

### `palette`

Named hue swatches. Every hue exposes `.color`, `.alt` (alias of `.light`), `.light`, `.text`, `.bg`, and `.border`.

| Hue       | Purpose                                        |
| --------- | ---------------------------------------------- |
| `cyan`    | Brand / primary accents                        |
| `sky`     | Board data, version, distance, speed           |
| `green`   | GPS, Android platform, success, battery        |
| `purple`  | Time, iOS platform, profiles                   |
| `amber`   | Weather sun, diagnostic indicators             |
| `orange`  | Warnings, motor and controller temperatures    |
| `red`     | Destructive actions, errors                    |
| `yellow`  | Stars, achievements, gauges                    |
| `blue`    | Currents, info states                          |
| `fuchsia` | Roll telemetry                                 |
| `pink`    | Balance pitch telemetry                        |
| `violet`  | Map trail / marker accents                     |
| `slate`   | Neutral surfaces, text, borders, map buildings |
| `mono`    | Pure black and white                           |

### `telemetry`

Single-color tokens for every metric. Use these for charts, sparklines, gauges, and live readouts so the same metric always has the same color.

| Token            | Source hue              |
| ---------------- | ----------------------- |
| `speed`          | `palette.sky.light`     |
| `duty`           | `palette.teal.color`    |
| `motorCurrent`   | `palette.blue.color`    |
| `battCurrent`    | `palette.blue.alt`      |
| `motorTemp`      | `palette.red.color`     |
| `controllerTemp` | `palette.orange.color`  |
| `battVoltage`    | `palette.green.light`   |
| `footpad1`       | `palette.slate.light`   |
| `footpad2`       | `palette.slate.color`   |
| `pitch`          | `palette.purple.color`  |
| `roll`           | `palette.fuchsia.light` |
| `balancePitch`   | `palette.pink.color`    |

### `map`

| Token           | Purpose              |
| --------------- | -------------------- |
| `user`          | Current GPS position |
| `target`        | Destination / target |
| `buildingDark`  | Dark map buildings   |
| `buildingLight` | Light map buildings  |

### `status`

Semantic UI-state tokens. Each exposes `.color`, `.text`, `.bg`, and `.border`.

| Token      | Meaning                |
| ---------- | ---------------------- |
| `info`     | Informational callouts |
| `success`  | Success / connected    |
| `warning`  | Warnings               |
| `error`    | Errors / destructive   |
| `favorite` | Favorites / stars      |

### `alpha`

Every translucent value (overlays, backdrops, zone tints, glow gradients, vignettes) must be created with `theme.alpha(color, level)` using one of the typed levels:

```ts
type AlphaLevel = 0 | 0.12 | 0.3 | 0.4 | 0.6 | 0.7 | 0.8 | 0.85 | 1
```

Neutral row icons use `theme.palette.slate.textSecondary`.

## Icons

Use `phosphor-react-native` with `weight="duotone"` as default weight. Each icon gets a distinct accent color from `theme` — do not reuse the same color for adjacent icons.

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
