import {
  lengthFromMeters,
  lengthUnit,
  speedFromKmh,
  speedUnit,
  type UnitSystem,
} from '@/helpers/units'

export type HillsPresetId = 'flat' | 'large' | 'small' | 'pumptrack' | 'custom'
export type MovementPresetId = 'manual' | 'slow' | 'rapid' | 'frontBack' | 'custom'

/** Canonical simulation inputs; selected units only affect the generated option labels. */
export const HILLS_PRESETS = {
  flat: { label: 'Flat road', heightMeters: 0, spacingMeters: 0 },
  large: { label: 'Large hills', heightMeters: 8, spacingMeters: 90 },
  small: { label: 'Small hills', heightMeters: 2, spacingMeters: 24 },
  pumptrack: { label: 'Pumptrack', heightMeters: 0.5, spacingMeters: 5 },
} as const

export const MOVEMENT_RANGES = {
  slow: { label: 'Wide speed range', lowKmh: 5, highKmh: 35 },
  rapid: { label: 'Quick speed range', lowKmh: 15, highKmh: 30 },
  frontBack: { label: 'Forward/back range', lowKmh: -10, highKmh: 10 },
} as const

function compact(value: number): string {
  return String(Number(value.toFixed(1)))
}

export function hillsOptions(units: UnitSystem): { value: HillsPresetId; label: string }[] {
  return [
    ...Object.entries(HILLS_PRESETS).map(([value, preset]) => ({
      value: value as HillsPresetId,
      label:
        value === 'flat'
          ? preset.label
          : `${preset.label} · ${compact(lengthFromMeters(preset.heightMeters, units))} ${lengthUnit(units)} · ${compact(lengthFromMeters(preset.spacingMeters, units))} ${lengthUnit(units)}`,
    })),
    { value: 'custom', label: 'Enter your own' },
  ]
}

export function movementOptions(units: UnitSystem): { value: MovementPresetId; label: string }[] {
  return [
    { value: 'manual', label: 'Manual pitch slider' },
    ...Object.entries(MOVEMENT_RANGES).map(([value, preset]) => ({
      value: value as MovementPresetId,
      label: `${preset.label} · ${compact(speedFromKmh(preset.lowKmh, units))}–${compact(speedFromKmh(preset.highKmh, units))} ${speedUnit(units)}`,
    })),
    { value: 'custom', label: 'Custom range' },
  ]
}
