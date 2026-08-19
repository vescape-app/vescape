import type { PresenceScanState } from 'vescape-core'

/**
 * Nothing scanned yet. Native replaces this wholesale on every snapshot; it exists so the store has
 * an honest shape before the first native `LiveState` arrives.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardPresenceScan.kt `PresenceScanState`
 * @parity /modules/vescape-core/ios/connection/BoardPresenceScan.swift `PresenceScanState`
 */
export const IDLE_PRESENCE_SCAN: PresenceScanState = {
  phase: 'idle',
  purpose: null,
  owner: 'none',
  startedAt: null,
  deadlineAt: null,
  observations: [],
  decision: null,
  reason: null,
}
