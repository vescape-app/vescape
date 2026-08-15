/**
 * Semantic color tokens for Vescape.
 *
 * New structure:
 *   - palette: named hue swatches + mono + slate (surface/text scale + map buildings)
 *   - telemetry: single-color token per metric
 *   - map: user/target/building colors
 *   - status: semantic UI-state tokens (info/success/warning/error/favorite)
 *   - alpha: typed opacity helper for every translucent value
 *
 * Never hardcode a color that belongs to one of these categories directly in a
 * component. Add new tokens here first, then reference them via theme.*.
 */

import * as ReactNative from 'react-native'

export type ResolvedTheme = 'light' | 'dark'

const ReactNativeModule =
  (ReactNative as typeof ReactNative & { default?: typeof ReactNative }).default ?? ReactNative

/** Allowed opacity levels for every translucent color value. */
export type AlphaLevel = 0 | 0.03 | 0.1 | 0.12 | 0.3 | 0.4 | 0.6 | 0.7 | 0.75 | 0.8 | 0.85 | 1

const ALPHA_RESOURCE_SUFFIX: Record<AlphaLevel, string> = {
  0: '000',
  0.03: '003',
  0.1: '010',
  0.12: '012',
  0.3: '030',
  0.4: '040',
  0.6: '060',
  0.7: '070',
  0.75: '075',
  0.8: '080',
  0.85: '085',
  1: '100',
}

interface AdaptiveColorMetadata {
  resource: string
  dark: string
  light: string
}

declare const adaptiveColorBrand: unique symbol
type AdaptiveColor = string & { readonly [adaptiveColorBrand]: true }

const adaptiveColorMetadata = new WeakMap<object, AdaptiveColorMetadata>()

function adaptiveColor(resource: string, dark: string, light: string): AdaptiveColor {
  const metadata: AdaptiveColorMetadata = { resource, dark, light }
  let color: unknown

  if (ReactNativeModule.Platform?.OS === 'ios') {
    color = ReactNativeModule.DynamicColorIOS({ dark, light })
  } else if (ReactNativeModule.Platform?.OS === 'android') {
    color = ReactNativeModule.PlatformColor(`@color/vescape_${resource}`)
  } else {
    return dark as AdaptiveColor
  }

  adaptiveColorMetadata.set(color as object, metadata)
  return color as AdaptiveColor
}

/** Resolve an adaptive native color to a renderer-safe string for the current appearance. */
export function resolveAdaptiveColor(color: unknown, appearance: 'light' | 'dark'): unknown {
  if (typeof color !== 'object' || color === null) return color
  const metadata = adaptiveColorMetadata.get(color)
  return metadata ? metadata[appearance] : color
}

function alpha(color: string, level: AlphaLevel): string {
  const colorValue = color as unknown
  const adaptive =
    typeof colorValue === 'object' && colorValue !== null
      ? adaptiveColorMetadata.get(colorValue)
      : undefined
  if (adaptive) {
    return adaptiveColor(
      `${adaptive.resource}_alpha_${ALPHA_RESOURCE_SUFFIX[level]}`,
      alpha(adaptive.dark, level),
      alpha(adaptive.light, level),
    )
  }

  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const [r, g, b] =
      hex.length === 3
        ? [
            Number.parseInt(hex[0] + hex[0], 16),
            Number.parseInt(hex[1] + hex[1], 16),
            Number.parseInt(hex[2] + hex[2], 16),
          ]
        : [
            Number.parseInt(hex.slice(0, 2), 16),
            Number.parseInt(hex.slice(2, 4), 16),
            Number.parseInt(hex.slice(4, 6), 16),
          ]
    return `rgba(${r},${g},${b},${level})`
  }

  if (color.startsWith('rgba')) {
    return color.replace(/,[^,]+\)$/, `,${level})`)
  }

  if (color.startsWith('rgb')) {
    return color.replace(')', `,${level})`).replace('rgb', 'rgba')
  }

  throw new Error(`Unsupported color format for alpha(): ${color}`)
}

type Hue = {
  color: string
  /** Alternate shade within the same hue — aliases `light`. */
  alt: string
  light: string
  text: string
  bg: string
  border: string
}

export type AccentHue = Hue & {
  /** Filled action background. */
  solid: string
  /** Content drawn on `solid`. */
  onSolid: string
}

function hue(
  color: string,
  light: string,
  text: string,
  bg: string,
  border: string,
  solid: string,
  onSolid: string,
): AccentHue {
  return { color, alt: light, light, text, bg, border, solid, onSolid }
}

/** Plain strings for renderers and for semantic solid/on-solid action pairs. */
export const accentColors = {
  dark: {
    sky: hue('#38bdf8', '#7dd3fc', '#7dd3fc', '#0c2a3f', '#0369a1', '#0369a1', '#ffffff'),
    cyan: hue('#06b6d4', '#67e8f9', '#67e8f9', '#083344', '#0e7490', '#0e7490', '#ffffff'),
    blue: hue('#60a5fa', '#818cf8', '#bfdbfe', '#0f1d2e', '#1e3a5f', '#1d4ed8', '#ffffff'),
    green: hue('#22c55e', '#4ade80', '#4ade80', '#14532d', '#15803d', '#15803d', '#ffffff'),
    amber: hue('#f59e0b', '#fbbf24', '#fde68a', '#451a03', '#92400e', '#b45309', '#ffffff'),
    orange: hue('#f97316', '#fb923c', '#fdba74', '#431407', '#9a3412', '#c2410c', '#ffffff'),
    red: hue('#ef4444', '#f87171', '#fca5a5', '#7f1d1d', '#991b1b', '#b91c1c', '#ffffff'),
    yellow: hue('#facc15', '#fde047', '#fde047', '#422006', '#854d0e', '#a16207', '#ffffff'),
    purple: hue('#a855f7', '#a78bfa', '#d8b4fe', '#1e1338', '#7e22ce', '#7e22ce', '#ffffff'),
    fuchsia: hue('#c084fc', '#e879f9', '#f0abfc', '#4a0444', '#a21caf', '#a21caf', '#ffffff'),
    violet: hue('#7c6fef', '#8b5cf6', '#a78bfa', '#2e1065', '#5b21b6', '#5b21b6', '#ffffff'),
    teal: hue('#14b8a6', '#2dd4bf', '#99f6e4', '#042f2e', '#0f766e', '#0f766e', '#ffffff'),
    groupRide: hue('#10c69a', '#5eead4', '#7af0d6', '#04302a', '#0c8f74', '#0f766e', '#ffffff'),
    pink: hue('#ec4899', '#f472b6', '#fbcfe8', '#500724', '#be185d', '#be185d', '#ffffff'),
    beige: hue('#d6c2a5', '#e8dcc8', '#f5eee4', '#3a3026', '#8d7353', '#806549', '#ffffff'),
  },
  light: {
    sky: hue('#0369a1', '#0284c7', '#075985', '#e0f2fe', '#7dd3fc', '#0ea5e9', '#082f49'),
    cyan: hue('#0e7490', '#0891b2', '#155e75', '#cffafe', '#67e8f9', '#22d3ee', '#083344'),
    blue: hue('#1d4ed8', '#2563eb', '#1e40af', '#dbeafe', '#93c5fd', '#2563eb', '#ffffff'),
    green: hue('#15803d', '#16a34a', '#166534', '#dcfce7', '#86efac', '#22c55e', '#052e16'),
    amber: hue('#b45309', '#d97706', '#92400e', '#fef3c7', '#fcd34d', '#f59e0b', '#451a03'),
    orange: hue('#c2410c', '#ea580c', '#9a3412', '#ffedd5', '#fdba74', '#f97316', '#431407'),
    red: hue('#b91c1c', '#dc2626', '#991b1b', '#fee2e2', '#fca5a5', '#dc2626', '#ffffff'),
    yellow: hue('#a16207', '#ca8a04', '#854d0e', '#fef9c3', '#fde047', '#facc15', '#422006'),
    purple: hue('#7e22ce', '#9333ea', '#6b21a8', '#f3e8ff', '#d8b4fe', '#7c3aed', '#ffffff'),
    fuchsia: hue('#a21caf', '#c026d3', '#86198f', '#fae8ff', '#f0abfc', '#d946ef', '#2e064d'),
    violet: hue('#6d28d9', '#7c3aed', '#5b21b6', '#ede9fe', '#c4b5fd', '#7c3aed', '#ffffff'),
    teal: hue('#0f766e', '#0d9488', '#115e59', '#ccfbf1', '#5eead4', '#14b8a6', '#042f2e'),
    groupRide: hue('#0f766e', '#0d9488', '#115e59', '#ccfbf1', '#5eead4', '#10b981', '#032e27'),
    pink: hue('#be185d', '#db2777', '#9d174d', '#fce7f3', '#f9a8d4', '#ec4899', '#3f071f'),
    beige: hue('#765f44', '#8d7353', '#614d37', '#f5eee4', '#d6c2a5', '#d6c2a5', '#3a3026'),
  },
} as const

export type ResolvedAccentColors = (typeof accentColors)[ResolvedTheme]

type AccentName = keyof (typeof accentColors)['dark']

function adaptiveHue(name: AccentName): Hue {
  const dark = accentColors.dark[name]
  const light = accentColors.light[name]
  const resourceName = name === 'groupRide' ? 'group_ride' : name
  return {
    color: adaptiveColor(`accent_${resourceName}_color`, dark.color, light.color),
    alt: adaptiveColor(`accent_${resourceName}_light`, dark.light, light.light),
    light: adaptiveColor(`accent_${resourceName}_light`, dark.light, light.light),
    text: adaptiveColor(`accent_${resourceName}_text`, dark.text, light.text),
    bg: adaptiveColor(`accent_${resourceName}_bg`, dark.bg, light.bg),
    border: adaptiveColor(`accent_${resourceName}_border`, dark.border, light.border),
  }
}

export const palette = {
  mono: { black: '#000000', white: '#ffffff' },
  slate: {
    color: '#64748b',
    alt: '#94a3b8',
    light: '#94a3b8',
    text: '#cbd5e1',
    bg: '#111827',
    surface: '#1e293b',
    surfaceDeep: '#0f172a',
    border: '#334155',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    textDim: '#475569',
    mapBuildingDark: '#3e4451',
    mapBuildingLight: '#e5e7eb',
  },
  sky: {
    ...adaptiveHue('sky'),
    snow: adaptiveColor('accent_sky_snow', '#bae6fd', '#0369a1'),
  },
  cyan: adaptiveHue('cyan'),
  blue: adaptiveHue('blue'),
  green: adaptiveHue('green'),
  amber: adaptiveHue('amber'),
  orange: adaptiveHue('orange'),
  red: adaptiveHue('red'),
  yellow: adaptiveHue('yellow'),
  purple: {
    ...adaptiveHue('purple'),
    thunder: adaptiveColor('accent_purple_thunder', '#c084fc', '#7e22ce'),
  },
  fuchsia: adaptiveHue('fuchsia'),
  violet: {
    ...adaptiveHue('violet'),
    moon: adaptiveColor('accent_violet_moon', '#a78bfa', '#6d28d9'),
  },
  teal: adaptiveHue('teal'),
  groupRide: adaptiveHue('groupRide'),
  pink: adaptiveHue('pink'),
  beige: adaptiveHue('beige'),
} as const

/** Appearance-aware neutral UI colors. Raw slate swatches stay in `palette.slate`; components use
 * this semantic layer so existing StyleSheets update natively without JS style regeneration. */
export const neutralColors = {
  dark: {
    bg: '#111827',
    surface: '#1e293b',
    surfaceDeep: '#0f172a',
    border: '#334155',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    textDim: '#475569',
  },
  light: {
    bg: '#e7edf4',
    surface: '#f4f7fb',
    surfaceDeep: '#d8e0ea',
    border: '#b6c3d1',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#566579',
    textDim: '#7a899c',
  },
} as const

/**
 * @parity /modules/vescape-core/android/src/main/res/values/colors.xml
 * @parity /modules/vescape-core/android/src/main/res/values-night/colors.xml
 * @platform-diff iOS resolves these same JS values through DynamicColorIOS; Android needs resources.
 */
export const neutral = {
  bg: adaptiveColor('neutral_bg', neutralColors.dark.bg, neutralColors.light.bg),
  surface: adaptiveColor(
    'neutral_surface',
    neutralColors.dark.surface,
    neutralColors.light.surface,
  ),
  surfaceDeep: adaptiveColor(
    'neutral_surface_deep',
    neutralColors.dark.surfaceDeep,
    neutralColors.light.surfaceDeep,
  ),
  border: adaptiveColor('neutral_border', neutralColors.dark.border, neutralColors.light.border),
  textPrimary: adaptiveColor(
    'neutral_text_primary',
    neutralColors.dark.textPrimary,
    neutralColors.light.textPrimary,
  ),
  textSecondary: adaptiveColor(
    'neutral_text_secondary',
    neutralColors.dark.textSecondary,
    neutralColors.light.textSecondary,
  ),
  textMuted: adaptiveColor(
    'neutral_text_muted',
    neutralColors.dark.textMuted,
    neutralColors.light.textMuted,
  ),
  textDim: adaptiveColor(
    'neutral_text_dim',
    neutralColors.dark.textDim,
    neutralColors.light.textDim,
  ),
} as const

export const telemetry = {
  speed: accentColors.dark.sky.color,
  duty: accentColors.dark.teal.color,
  motorCurrent: accentColors.dark.blue.light,
  battCurrent: accentColors.dark.blue.color,
  controllerTemp: accentColors.dark.orange.color,
  motorTemp: accentColors.dark.red.color,
  battVoltage: accentColors.dark.green.light,
  footpad1: palette.slate.light,
  footpad2: palette.slate.color,
  pitch: accentColors.dark.purple.light,
  roll: accentColors.dark.fuchsia.color,
  balancePitch: accentColors.dark.fuchsia.light,
  altitude: accentColors.dark.amber.color,
  gpsAccuracy: accentColors.dark.green.light,
} as const

export const map = {
  user: accentColors.dark.purple.color,
  target: accentColors.dark.green.color,
  buildingDark: palette.slate.mapBuildingDark,
  buildingLight: palette.slate.mapBuildingLight,
} as const

export const status = {
  info: {
    color: palette.blue.color,
    text: palette.blue.text,
    bg: palette.blue.bg,
    border: palette.blue.border,
  },
  success: {
    color: palette.green.color,
    text: palette.green.text,
    bg: palette.green.bg,
    border: palette.green.border,
  },
  caution: {
    color: palette.yellow.color,
    text: palette.yellow.text,
    bg: palette.yellow.bg,
    border: palette.yellow.border,
  },
  warning: {
    color: palette.orange.color,
    text: palette.orange.text,
    bg: palette.orange.bg,
    border: palette.orange.border,
  },
  error: {
    color: palette.red.color,
    text: palette.red.text,
    bg: palette.red.bg,
    border: palette.red.border,
  },
  favorite: {
    color: palette.yellow.color,
    text: palette.yellow.text,
    bg: palette.yellow.bg,
    border: palette.yellow.border,
  },
  upgrade: {
    color: palette.purple.color,
    text: palette.purple.text,
    bg: palette.purple.bg,
    border: palette.purple.border,
  },
} as const

/** Tune Profile actions and entry points. */
export const tune = palette.purple

/** Icon accent shared by every entry point for a settings destination. */
export const settingsIcon = {
  account: palette.cyan.color,
  sync: palette.cyan.color,
  update: status.upgrade.color,
  database: status.warning.color,
  link: palette.purple.color,
  connection: palette.purple.color,
  liveTelemetry: telemetry.speed,
  diagnostics: status.warning.color,
  map: palette.sky.color,
  watch: palette.amber.color,
  privacyZones: palette.green.color,
  filters: palette.purple.color,
  graphs: palette.cyan.color,
  advanced: neutral.textSecondary,
  dev: palette.yellow.color,
  about: palette.cyan.color,
} as const

/** Banner callouts — flat row, accent icon + neutral text. */
export const banner = {
  info: { icon: status.info.color },
  warning: { icon: status.warning.color },
  error: { icon: status.error.color },
} as const

/** Weather condition icon colors — derived from palette. */
export const weather = {
  sun: palette.amber.light,
  partly: palette.amber.color,
  moon: palette.violet.moon,
  moonPartly: palette.violet.color,
  cloud: palette.slate.light,
  fog: palette.slate.text,
  rain: palette.blue.color,
  snow: palette.sky.snow,
  thunder: palette.purple.thunder,
} as const

/** Privacy zone tints — derived from palette via alpha(). */
export const zone = {
  bg: alpha(palette.green.color, 0.12),
  border: alpha(palette.green.color, 0.6),
  borderDim: alpha(palette.slate.color, 0.6),
} as const

/** Shared press/touch interaction tokens. */
export const interaction = {
  /** Android ripple for bounded pressables (cards, cells). */
  ripple: {
    color: alpha(neutral.textSecondary, 0.12),
    borderless: false,
    foreground: true,
  },
  /** Android ripple for icon-only pressables with no visible bounds. */
  rippleBorderless: {
    color: alpha(neutral.textSecondary, 0.12),
    borderless: true,
    foreground: true,
  },
  /** iOS/cross-platform pressed background for list rows and sheet items. */
  pressedBg: neutral.surface,
  /** iOS/cross-platform pressed opacity for metric cells and icon buttons. */
  pressedOpacity: 0.55,
} as const

/** Weights shipped as static Raleway instances in `assets/fonts/`. Android ignores the
 *  `wght` variation axis of a custom variable font (it renders the file's default
 *  instance), so each weight is its own font file and family name. */
export type FontWeight = '300' | '400' | '500' | '600' | '700' | '800' | '900'

/** App-wide UI font family for a given weight. Load via `useFonts` in
 *  `src/app/_layout.tsx` before first render. Monospace readouts
 *  (`fontFamily: 'monospace'`) bypass this token by inlining their value. */
export const font = (weight: FontWeight = '500') => `Raleway-${weight}`

export type MonoWeight = '500' | '600' | '700' | '800'

/** Static JetBrains Mono family used by numeric readouts. */
export const mono = (weight: MonoWeight = '700') => `JetBrainsMono-${weight}`

export const theme = {
  palette,
  neutral,
  telemetry,
  map,
  status,
  tune,
  settingsIcon,
  alpha,
  banner,
  weather,
  zone,
  interaction,
  font,
  mono,
} as const
