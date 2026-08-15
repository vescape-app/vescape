# React Native

React Native UI conventions for this repo. Add component, styling, navigation, animation, and Expo Router guidance here when it becomes stable enough to apply across the app.

For visual design principles (colors, layout, typography, when to use cards), see [`docs/design.md`](../design.md).

## Colors

Every color must come from the `theme` object in `src/constants/theme.ts`. Never hardcode a hex or rgba value directly in a component.

Use `theme.neutral` for the white/read-only canvas, separators, and neutral copy. Use `theme.control` for interactive surfaces and their foregrounds. Use `theme.palette.<hue>` for adaptive accent text, icons, borders, and small tinted states rendered by React Native. Metric visuals use `theme.telemetry`. Raw `theme.palette.slate` values are fixed dark swatches for map JSON and other non-adaptive assets.

The adaptive neutral, control, accent, and telemetry tokens are native color objects at runtime. Mapbox, Skia, Reanimated worklets, and string-valued state/options cannot consume them. Use the corresponding hooks from `src/hooks/useTheme.ts`: `useResolvedNeutralColors()`, `useResolvedControlColors()`, `useResolvedAccentColors()`, and `useResolvedTelemetryColors()`. Pass only their plain string values into the renderer or data structure.

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

When creating or significantly changing a reusable UI component, add or update its showcase in
`src/app/settings/components.tsx` in the same change.

- When asked to create a component, create a real component file under `src/components/` or the
  appropriate subdirectory such as `src/components/settings/`. Do not hide reusable UI as a
  function at the top of a screen file.
- Use existing `ShowcaseCard` and controls from `@/components/dev/ShowcaseControls`.
- Include useful variants, states, and props that future agents/design checks need to see.
- Keep showcase data local and deterministic enough for quick visual inspection.
- Skip only components that are route-specific screens or tiny private sub-components with no reuse surface.

## Icons

Use **`phosphor-react-native`** for all icons. Do **not** use emoji or unicode characters as icon substitutes.

```tsx
import { LightningIcon, WarningCircleIcon } from 'phosphor-react-native'
import { theme } from '@/constants/theme'
;<LightningIcon size={16} color={theme.gps.text} weight="fill" />
```

- Always use the **`Icon`-suffixed** export, for example `LightningIcon`, not `Lightning`. The un-suffixed names are deprecated and will produce warnings.
- The `type Icon` export for typing icon props is **not** suffixed; import it as `type Icon` as-is.
- `size` is typically `10`-`16` for inline or label icons, larger for standalone UI elements.

## Icon buttons

Use **`IconButton`** (`@/components/IconButton`) for all circular icon-only pressables. Do not build ad-hoc `Pressable` + icon combinations.

```tsx
import { IconButton } from '@/components/IconButton'
import { ArrowLeftIcon, TrashIcon } from 'phosphor-react-native'

<IconButton icon={ArrowLeftIcon} onPress={handleBack} />
<IconButton icon={TrashIcon} destructive onPress={handleDelete} disabled={!canDelete} />
<IconButton icon={ArrowsClockwiseIcon} size="lg" loading={syncing} onPress={handleSync} />
```

- `size`: `'sm'` (default, 38×38 — headers, overlays) | `'lg'` (54×54 — bottom/content area)
- `destructive` shifts border to red-tinted and auto-tints icon to `theme.error.text` — no manual color needed
- `loading` disables the button and shows an `ActivityIndicator` in the icon color
- `style` accepts layout-level `ViewStyle` (position, margin, bottom/top/left/right)
- The default surface uses `theme.control.background`, `theme.control.border`, and `theme.control.icon`; destructive state changes the accent without abandoning the navy interaction language.

## Buttons

Use **`Button`** (`@/components/Button`) for all tappable button actions. Do not build ad-hoc `Pressable` + `Text` combinations for buttons.

```tsx
import { Button } from '@/components/Button'
import { TrashIcon } from 'phosphor-react-native'

<Button label="Save" onPress={handleSave} />
<Button label="Cancel" variant="secondary" onPress={handleCancel} />
<Button label="Delete" variant="destructive" icon={TrashIcon} onPress={handleDelete} />
<Button label="Saving…" loading={isSaving} onPress={handleSave} />
```

- `variant`: `'primary'` (default, blue fill) | `'secondary'` (ghost/outline) | `'destructive'` (red fill)
- `size`: `'md'` (default, h40) | `'sm'` (h32)
- `icon`: phosphor `Icon` type — rendered left of the label
- `loading` disables the button and shows an `ActivityIndicator`
- `style` accepts layout-level `ViewStyle` (e.g. `flex: 1`, margins) — do not use it for visual overrides

## Confirmation dialogs

Use **`ConfirmModal`** (`@/components/ConfirmModal`) instead of `Alert.alert` for all confirmation prompts. `Alert.alert` renders a plain OS dialog that looks out of place in the dark-themed UI.

```tsx
import { ConfirmModal } from '@/components/ConfirmModal'

const [confirmVisible, setConfirmVisible] = useState(false)

<ConfirmModal
  visible={confirmVisible}
  title="Delete item"
  message="This cannot be undone."
  confirmLabel="Delete"
  destructive
  onConfirm={() => { deleteItem(); setConfirmVisible(false) }}
  onCancel={() => setConfirmVisible(false)}
/>
```

- Drive visibility with state (`useState<boolean>` or `useState<T | null>` when you need to remember _what_ to confirm).
- Set `destructive` for irreversible actions — it renders the confirm button in red.
- `confirmLabel` and `cancelLabel` default to "Confirm" / "Cancel"; override when a specific verb is clearer.
