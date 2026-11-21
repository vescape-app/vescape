import type { Board } from 'vescape-core'

import { deriveBatteryConfig } from '@/modules/battery/lib'

export const DEFAULT_BOARD_TOP_SPEED_KMH = 50

export function boardTopSpeedKmh(board: Board | null | undefined): number {
  const value = board?.topSpeedKmh
  return typeof value === 'number' && value > 0 ? value : DEFAULT_BOARD_TOP_SPEED_KMH
}

export function boardHasBatteryConfig(board: Board | null | undefined): boolean {
  return deriveBatteryConfig(board?.batteryConfig ?? null).warning == null
}
