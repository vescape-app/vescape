import { StyleSheet, View } from 'react-native'
import { SlidersHorizontalIcon } from 'phosphor-react-native'

import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'

/** A decoded config value, or `undefined` when the schema does not carry the field. */
export type BoardConfigValue = number | boolean | undefined

export interface BoardConfigRow {
  /** Refloat schema field id, e.g. `fault_adc1`. */
  id: string
  /** Rider-facing name. Refloat's own wording is often terse; say what it does instead. */
  label: string
  format: (value: BoardConfigValue) => string
  /** One line under the row for a value that changes how the board behaves. */
  note?: (value: BoardConfigValue) => string | null
}

const MISSING = '—'

/** `1.85 V`, or "Disabled" for the zero that turns a switch off rather than setting it low. */
export function volts(value: BoardConfigValue, zeroLabel?: string): string {
  if (typeof value !== 'number') return MISSING
  if (value === 0 && zeroLabel) return zeroLabel
  return `${value.toFixed(2)} V`
}

/** Refloat stores its fault delays in milliseconds; seconds read better past a second. */
export function millis(value: BoardConfigValue): string {
  if (typeof value !== 'number') return MISSING
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`
}

export function erpm(value: BoardConfigValue): string {
  return typeof value === 'number' ? `${Math.round(value)} ERPM` : MISSING
}

/**
 * Refloat's toggles are `<type>5</type>` in the settings XML, which the schema reads as an `int8` —
 * so a toggle arrives as `1` / `0`, not as a bool. Both are accepted rather than assuming either.
 */
export function isEnabled(value: BoardConfigValue): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return null
}

export function onOff(value: BoardConfigValue): string {
  const enabled = isEnabled(value)
  return enabled == null ? MISSING : enabled ? 'On' : 'Off'
}

/**
 * A read-only window onto part of this Board Session's Refloat config, next to the live telemetry it
 * explains — a footpad chart means little without the voltage the board actually engages at.
 *
 * Every screen passes its own rows, so the same section serves duty, tiltback or fault angles later
 * without a second component. Read-only on purpose: config is written from Tune against the native
 * write base, never from a decoded map (ADR 0035).
 */
export function BoardConfigSection({
  title = 'Board config',
  rows,
}: {
  title?: string
  rows: BoardConfigRow[]
}) {
  const values = useBoardConfigValuesStore((s) => s.values)

  return (
    <View style={styles.section}>
      <SectionHeader
        icon={SlidersHorizontalIcon}
        color={theme.palette.sky.color}
        title={title}
        right={
          values?.freshness === 'last-known' ? <Text style={styles.stale}>Last known</Text> : null
        }
      />
      <View style={styles.card}>
        {values == null ? (
          <Text style={styles.empty}>Connect the board to read its config.</Text>
        ) : (
          rows.map((row) => {
            const value = values.values[row.id]
            const note = row.note?.(value)
            return (
              <View key={row.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.label}>{row.label}</Text>
                  <Text style={styles.value}>{row.format(value)}</Text>
                </View>
                {note ? <Text style={styles.note}>{note}</Text> : null}
              </View>
            )
          })
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  card: {
    gap: 2,
  },
  row: {
    paddingVertical: 7,
    gap: 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    flex: 1,
    color: theme.palette.slate.textSecondary,
    fontSize: 14,
  },
  value: {
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  note: {
    color: theme.palette.slate.textDim,
    fontSize: 12,
  },
  stale: {
    color: theme.palette.slate.textDim,
    fontSize: 12,
  },
  empty: {
    color: theme.palette.slate.textDim,
    fontSize: 14,
    paddingVertical: 7,
  },
})
