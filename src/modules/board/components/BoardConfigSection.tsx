import { StyleSheet, View } from 'react-native'
import { SlidersHorizontalIcon } from 'phosphor-react-native'

import { Placeholder } from '@/components/base/Placeholder'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useBoardConfigFields } from '@/modules/board/store/boardConfigValuesStore'
import type { BoardConfigFieldId } from 'vescape-core'

/** A decoded config value, or `undefined` when the schema does not carry the field. */
export type BoardConfigValue = number | boolean | undefined

/**
 * VESC motor config (MCCONF) field ids these screens name. A separate union from
 * {@link BoardConfigFieldId} because MCCONF is a different schema entirely: VESC serves a bare blob
 * decoded against a signature, Refloat serves its own XML (ADR 0036).
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfLayouts.kt
 * @parity /modules/vescape-core/ios/config/McconfLayouts.swift
 */
export type MotorConfigFieldId =
  | 'l_abs_current_max'
  | 'l_battery_cut_end'
  | 'l_battery_cut_start'
  | 'l_current_max'
  | 'l_current_min'
  | 'l_in_current_max'
  | 'l_in_current_min'
  | 'l_max_duty'
  | 'l_max_erpm'
  | 'l_max_vin'
  | 'l_min_erpm'
  | 'l_min_vin'
  | 'l_temp_fet_end'
  | 'l_temp_fet_start'
  | 'l_temp_motor_end'
  | 'l_temp_motor_start'

/** One readout row over a config map, keyed by whichever schema's ids the screen reads. */
export interface ConfigRow<Id extends string> {
  /**
   * Schema field id, typed against the named set so a mistyped id is a compile error rather than a
   * row that renders an em dash forever.
   */
  id: Id
  /** Rider-facing name. Refloat's own wording is often terse; say what it does instead. */
  label: string
  format: (value: BoardConfigValue) => string
  /** One line under the row for a value that changes how the board behaves. */
  note?: (value: BoardConfigValue) => string | null
}

export type BoardConfigRow = ConfigRow<BoardConfigFieldId>
export type MotorConfigRow = ConfigRow<MotorConfigFieldId>

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
 * A numeric field with Refloat's own suffix. `decimals` follows the field's real resolution — an
 * angle in whole degrees printed as `5.0°` reads as a precision the board does not have.
 */
export function unit(suffix: string, decimals = 1): (value: BoardConfigValue) => string {
  const separator = suffix.startsWith('°') && suffix.length === 1 ? '' : ' '
  return (value) =>
    typeof value === 'number' ? `${value.toFixed(decimals)}${separator}${suffix}` : MISSING
}

/** A `0…1` fraction as a percentage — Refloat stores duty that way, riders read it as `80%`. */
export function percent(value: BoardConfigValue): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : MISSING
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
 * The shape this section renders: a decoded field map and how fresh it is. Both Refloat config
 * (ADR 0035) and VESC motor config (ADR 0036) satisfy it, which is why one component serves both.
 */
export interface BoardConfigSectionValues {
  freshness: 'fresh' | 'last-known'
  values: Record<string, number | boolean>
}

/**
 * A read-only window onto part of this Board Session's config, next to the live telemetry it
 * explains — a footpad chart means little without the voltage the board actually engages at.
 *
 * Every screen passes its own rows, so the same section serves duty, tiltback or fault angles
 * without a second component. Pass `values` to render a config other than Refloat's — the motor
 * temperature screens read VESC motor config, which has its own store. Read-only on purpose: config
 * is written from Tune against the native write base, never from a decoded map, and motor config is
 * never written at all.
 */
export function BoardConfigSection({
  title = 'Board config',
  rows,
  values: override,
  empty = 'No config read from this board yet. Connect it to read its setup.',
}: {
  title?: string
  /** Any schema's rows: the section only reads `values[row.id]`, it never names a field itself. */
  rows: ConfigRow<string>[]
  /** Defaults to this Board's Refloat config. */
  values?: BoardConfigSectionValues | null
  empty?: string
}) {
  const refloat = useBoardConfigFields()
  const values = override === undefined ? refloat : override

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
          <Placeholder icon={SlidersHorizontalIcon} description={empty} style={styles.empty} />
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
    // The section is one block in a scrolling screen, so the placeholder sizes to its content
    // instead of taking the height a whole empty screen would.
    flex: 0,
    paddingVertical: 24,
  },
})
