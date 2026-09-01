import { theme } from '@/constants/theme'

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
   * Keep this key out of the rows entirely. Link bookkeeping the board sends so the app can
   * measure the connection is reported in the Link section, not as a sensor reading.
   */
  hidden?: true
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
  seq: {
    label: 'Frame',
    unit: '',
    decimals: 0,
    color: theme.neutral.textMuted,
    chart: false,
    hidden: true,
  },
  readMs: {
    label: 'Sensor read',
    unit: 'ms',
    decimals: 0,
    color: theme.neutral.textMuted,
    chart: false,
    hidden: true,
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
  hidden: boolean
  range?: { min: number; max: number }
}

/**
 * A raw frame value in display units, clamped to the key's range. Separate from
 * {@link describeReading} because the charts call it once per sample: at 50 frames a second an
 * object and a formatted string per point is the difference between a smooth chart and a stutter.
 */
export function readingValue(key: string, raw: number | null): number | null {
  const spec = READINGS[key] ?? UNKNOWN
  if (raw == null) {
    // A ranged sensor reading nothing means nothing is within its reach, which is the ceiling.
    // Same value the chart draws, so the row and the line cannot disagree.
    return spec.range ? spec.range.max : null
  }
  const converted = spec.toDisplay ? spec.toDisplay(raw) : raw
  return spec.range ? Math.min(Math.max(converted, spec.range.min), spec.range.max) : converted
}

/** Everything a frame key needs to be rendered, whether or not the app knows the key. */
export function describeReading(key: string, raw: number | null): Reading {
  const spec = READINGS[key] ?? { ...UNKNOWN, label: key }
  const value = readingValue(key, raw)
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
    hidden: spec.hidden === true,
    range: spec.range,
  }
}

/**
 * One row per key, in the order given, minus the link bookkeeping the board sends for itself.
 *
 * Rows carry no value: the numbers arrive far faster than React should render, so a row is the
 * label and the shape, and the value behind it is a shared value the UI thread writes. Rows are
 * kept even once a sensor stops answering, since the ToF drops out whenever nothing is in range
 * and letting the row go makes everything below it jump.
 */
export function describeReadings(keys: readonly string[]): Reading[] {
  return keys.map((key) => describeReading(key, null)).filter((reading) => !reading.hidden)
}
