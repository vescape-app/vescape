import type { VescFaultOccurrence, VescFaultSource } from 'vescape-core'

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

/**
 * VESC `mc_fault_code` names — the controller's own motor faults, printed by its `faults` terminal
 * register. A **different code space** from `FAULT_TITLES` above: code 6 is "pitch angle exceeded"
 * to Refloat and "motor over temperature" to the controller, so the two must never share a lookup.
 * @parity /modules/vescape-core/ios/faults/VescFaultRegister.swift `vescFaultCodeForName`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegister.kt `CODES_BY_NAME`
 */
const REGISTER_FAULT_TITLES: Record<number, string> = {
  0: 'No fault',
  1: 'Over voltage',
  2: 'Under voltage',
  3: 'DRV fault',
  4: 'Absolute over current',
  5: 'MOSFET over temperature',
  6: 'Motor over temperature',
  7: 'Gate driver over voltage',
  8: 'Gate driver under voltage',
  9: 'MCU under voltage',
  10: 'Booting from watchdog reset',
  11: 'Encoder SPI fault',
  12: 'Encoder amplitude below minimum',
  13: 'Encoder amplitude above maximum',
  14: 'Flash corruption',
  15: 'Current sensor 1 offset too high',
  16: 'Current sensor 2 offset too high',
  17: 'Current sensor 3 offset too high',
  18: 'Unbalanced currents',
  19: 'Brake fault',
  20: 'Resolver loss of tracking',
  21: 'Resolver degradation of signal',
  22: 'Resolver loss of signal',
  23: 'App config flash corruption',
  24: 'Motor config flash corruption',
  25: 'Encoder magnet missing',
  26: 'Encoder magnet too strong',
  27: 'Phase filter fault',
  28: 'Encoder fault',
  29: 'Low voltage output fault',
}

/**
 * Code native stores for a register entry whose firmware fault name this build does not know. The
 * name survives verbatim in the register snapshot; the occurrence only records that it is unknown.
 * @parity /modules/vescape-core/ios/faults/VescFaultRegisterCoordinator.swift `unknownRegisterCode`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegisterCoordinator.kt `UNKNOWN_REGISTER_CODE`
 */
const UNKNOWN_REGISTER_CODE = -1

/**
 * Human title for a fault code, falling back to the raw code for firmware Vescape does not know.
 *
 * The code space follows the occurrence's source: a `live` occurrence carries a Refloat fault code,
 * a `register`/`baseline` one carries a controller `mc_fault_code`. Reading either through the
 * other's table would name the wrong fault, so the source is required.
 */
export function faultTitle(code: number, source: VescFaultSource = 'live'): string {
  if (source === 'live') return FAULT_TITLES[code] ?? `Fault code ${code}`
  if (code === UNKNOWN_REGISTER_CODE) return 'Unknown controller fault'
  return REGISTER_FAULT_TITLES[code] ?? `Controller fault code ${code}`
}

/**
 * Occurrences that should drive the shared Board health icon: undismissed, and not a link-time
 * `baseline` (stale untimed controller evidence must never look like a new incident).
 */
export function indicatorFaults(faults: VescFaultOccurrence[]): VescFaultOccurrence[] {
  return faults.filter((f) => !f.dismissed && f.source !== 'baseline')
}
