import type { Board } from 'vescape-core'

import { deriveBatteryConfig } from '@/modules/battery/lib'

/**
 * Board Top Speed and the battery config are Board Settings keys (#254) the Alert Presets read.
 * These pure getters fall back to the same display defaults native applies when a key is absent,
 * so callers never special-case a missing value.
 */

/** Display default Board Top Speed (km/h) when a Board has no `topSpeedKmh` setting. Mirrors native. */
export const DEFAULT_BOARD_TOP_SPEED_KMH = 50

export function boardTopSpeedKmh(board: Board | null | undefined): number {
  const value = board?.topSpeedKmh
  return typeof value === 'number' && value > 0 ? value : DEFAULT_BOARD_TOP_SPEED_KMH
}

export function boardHasBatteryConfig(board: Board | null | undefined): boolean {
  return deriveBatteryConfig(board?.batteryConfig ?? null).warning == null
}
