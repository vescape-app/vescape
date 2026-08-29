import type { VescFaultOccurrence } from 'vescape-core'

/**
 * Refloat fault-code names, mirroring the native fault-code table. The numeric code is the canonical
 * value — this map is a display convenience only, so an unknown future code must still render.
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `refloatFaultName`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescTelemetryModels.kt `refloatFaultName`
 */
const FAULT_TITLES: Record<number, string> = {
  0: 'No fault',
  6: 'Pitch angle exceeded',
  7: 'Roll angle exceeded',
  8: 'One footpad zone off',
  9: 'Both footpad zones off',
  11: 'Startup check failed',
  12: 'Reverse stop',
  13: 'Quickstop',
}

/** Human title for a fault code, falling back to the raw code for firmware Vescape does not know. */
export function faultTitle(code: number): string {
  return FAULT_TITLES[code] ?? `Fault code ${code}`
}

/**
 * Occurrences that should drive the shared Board health icon: undismissed, and not a link-time
 * `baseline` (stale untimed controller evidence must never look like a new incident).
 */
export function indicatorFaults(faults: VescFaultOccurrence[]): VescFaultOccurrence[] {
  return faults.filter((f) => !f.dismissed && f.source !== 'baseline')
}
