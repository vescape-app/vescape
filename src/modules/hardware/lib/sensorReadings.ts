import { theme } from '@/constants/theme'

import type { SensorFrame } from '@/modules/hardware/lib/parseSensorFrame'

/** How one frame key is shown. Keys with no entry fall back to raw value and key name. */
interface ReadingSpec {
  label: string
  unit: string
  decimals: number
  color: string
  /** Frame units to display units. Both distance sensors are shown in cm whatever they report. */
  toDisplay?: (value: number) => number
  /**
   * Keep this reading out of the charts. Uptime is the clock the others are drawn against, and
   * chip health is a number to glance at, not a line worth the height on this screen.
   */
  chart?: false
  /**
   * Display range, in display units. Values are clamped into it and the chart axis is fixed to
   * it, so a distance row keeps one scale instead of rescaling itself around whatever noise the
   * sensor last returned.
   */
  range?: { min: number; max: number }
}

/** Useful reach for both distance sensors on a board. Anything past this is not a reading. */
const DISTANCE_RANGE = { min: 0, max: 40 }

const READINGS: Record<string, ReadingSpec> = {
  distanceMm: {
    label: 'Distance (ToF)',
    unit: 'cm',
    decimals: 1,
    color: theme.palette.cyan.color,
    toDisplay: (mm) => mm / 10,
    range: DISTANCE_RANGE,
  },
  rangeCm: {
    label: 'Range (ultrasonic)',
    unit: 'cm',
    decimals: 1,
    color: theme.palette.violet.color,
    range: DISTANCE_RANGE,
  },
  tempC: {
    label: 'Chip temperature',
    unit: '°C',
    decimals: 1,
    color: theme.palette.amber.color,
    chart: false,
  },
  heapKb: {
    label: 'Free heap',
    unit: 'kB',
    decimals: 0,
    color: theme.palette.green.color,
    chart: false,
  },
  upMs: {
    label: 'Uptime',
    unit: 's',
    decimals: 0,
    color: theme.neutral.textMuted,
    toDisplay: (ms) => ms / 1000,
    chart: false,
  },
}

const UNKNOWN: Omit<ReadingSpec, 'label'> = {
  unit: '',
  decimals: 1,
  color: theme.palette.sky.color,
}

export interface Reading {
  key: string
  label: string
  unit: string
  decimals: number
  color: string
  /** Value in display units, clamped to the spec range, or null when the sensor read nothing. */
  value: number | null
  text: string
  chart: boolean
  range?: { min: number; max: number }
}

/** Everything a frame key needs to be rendered, whether or not the app knows the key. */
export function describeReading(key: string, raw: number | null): Reading {
  const spec = READINGS[key] ?? { ...UNKNOWN, label: key }
  let value: number | null = null
  if (raw != null) {
    const converted = spec.toDisplay ? spec.toDisplay(raw) : raw
    value = spec.range ? Math.min(Math.max(converted, spec.range.min), spec.range.max) : converted
  } else if (spec.range) {
    // A ranged sensor reading nothing means nothing is within its reach, which is the ceiling.
    // Same value the chart draws, so the row and the line cannot disagree.
    value = spec.range.max
  }
  const number = value == null ? '-' : value.toFixed(spec.decimals)
  return {
    key,
    label: spec.label,
    unit: spec.unit,
    decimals: spec.decimals,
    color: spec.color,
    value,
    text: value != null && spec.unit ? `${number} ${spec.unit}` : number,
    chart: spec.chart !== false,
    range: spec.range,
  }
}

/**
 * One row per key seen on this link, in the order the board first sent them.
 *
 * Rows are held even once a sensor stops answering: the ToF drops out whenever nothing is in
 * range, and letting the row go makes everything below it jump. A ranged sensor shows its ceiling
 * then, anything else shows `-`.
 */
export function describeReadings(frames: SensorFrame[]): Reading[] {
  const keys: string[] = []
  for (const frame of frames) {
    for (const key of Object.keys(frame.values)) if (!keys.includes(key)) keys.push(key)
  }
  const latest = frames.at(-1)
  return keys.map((key) => describeReading(key, latest?.values[key] ?? null))
}
