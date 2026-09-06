import type { Board } from 'vescape-core'

import { deriveBatteryConfig } from '@/modules/battery/lib'
import {
  DEFAULT_ALERT_PRESET_SELECTION,
  normalizeAlertPresetSelection,
  supportsBoardConfigMatch,
  type AlertPresetMetric,
  type AlertPresetSelection,
} from '@/modules/alerts/lib/alertPresets'

/**
 * Alert Preset selection, Board Top Speed and the onboarding flag are Board Settings keys (#254) —
 * each Board owns its own alert setup. These pure getters read a Board's fields and fall back to the
 * same display defaults native applies when a key is absent, so callers never special-case a missing
 * value. No preset rules generate until the rider touches setup (selection defaults to all Off).
 */

/** Display default Board Top Speed (km/h) when a Board has no `topSpeedKmh` setting. Mirrors native. */
export const DEFAULT_BOARD_TOP_SPEED_KMH = 50

export function boardTopSpeedKmh(board: Board | null | undefined): number {
  const value = board?.topSpeedKmh
  return typeof value === 'number' && value > 0 ? value : DEFAULT_BOARD_TOP_SPEED_KMH
}

export function boardAlertPresetSelection(board: Board | null | undefined): AlertPresetSelection {
  return normalizeAlertPresetSelection(board?.alertPreset ?? DEFAULT_ALERT_PRESET_SELECTION)
}

export function boardHasBatteryConfig(board: Board | null | undefined): boolean {
  return deriveBatteryConfig(board?.batteryConfig ?? null).warning == null
}

/** Which metrics this Board matches to its own configuration. Unknown keys and metrics that have
 * no anchor to follow are dropped, so a stale bag cannot arm a match the generator ignores. */
export function boardMatchBoardConfig(
  board: Board | null | undefined,
): Partial<Record<AlertPresetMetric, boolean>> {
  const raw = board?.matchBoardConfig
  if (!raw || typeof raw !== 'object') return {}
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([metric, enabled]) =>
      enabled === true && supportsBoardConfigMatch(metric as AlertPresetMetric),
  )
  return Object.fromEntries(entries) as Partial<Record<AlertPresetMetric, boolean>>
}
