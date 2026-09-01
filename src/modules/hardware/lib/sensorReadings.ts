import { theme } from '@/constants/theme'

/**
 * How one frame key is shown. Presentation only: what a raw value means — its scale, its range,
 * whether it is worth a chart — is the firmware contract and is decided natively, so the numbers
 * arriving here are already in display units.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/hardware/SensorReadings.kt `ReadingSpec`
 */
interface ReadingSpec {
  label: string
  unit: string
  decimals: number
  color: string
  /**
   * Keep this key out of the rows entirely. Link bookkeeping the board sends so the app can
   * measure the connection is reported in the Link section, not as a sensor reading.
   */
  hidden?: true
}

const READINGS: Record<string, ReadingSpec> = {
  distanceMm: {
    label: 'Distance (ToF)',
    unit: 'cm',
    decimals: 1,
    color: theme.palette.cyan.color,
  },
  rangeCm: {
    label: 'Range (ultrasonic)',
    unit: 'cm',
    decimals: 1,
    color: theme.palette.violet.color,
  },
  tempC: {
    label: 'Chip temperature',
    unit: '°C',
    decimals: 1,
    color: theme.palette.amber.color,
  },
  heapKb: {
    label: 'Free heap',
    unit: 'kB',
    decimals: 0,
    color: theme.palette.green.color,
  },
  seq: {
    label: 'Frame',
    unit: '',
    decimals: 0,
    color: theme.neutral.textMuted,
    hidden: true,
  },
  readMs: {
    label: 'Sensor read',
    unit: 'ms',
    decimals: 0,
    color: theme.neutral.textMuted,
    hidden: true,
  },
  upMs: {
    label: 'Uptime',
    unit: 's',
    decimals: 0,
    color: theme.neutral.textMuted,
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
  hidden: boolean
}

/** Everything a frame key needs to be rendered, whether or not the app knows the key. */
export function describeReading(key: string): Reading {
  const spec = READINGS[key] ?? { ...UNKNOWN, label: key }
  return {
    key,
    label: spec.label,
    unit: spec.unit,
    decimals: spec.decimals,
    color: spec.color,
    hidden: spec.hidden === true,
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
  return keys.map(describeReading).filter((reading) => !reading.hidden)
}
