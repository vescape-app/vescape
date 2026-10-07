import type { VescFaultOccurrence } from 'vescape-core'

export interface VescFaultInfo {
  title: string
  /** What the controller detected, in plain language. Possible causes stay phrased as possibilities. */
  description: string
}

/**
 * VESC controller fault catalog, keyed by `mc_fault_code` — the byte Refloat returns in its ALLDATA
 * fault-mode response. Not the Refloat riding state (pitch, roll, footpad…) and not a BMS fault code:
 * those are separate enums.
 *
 * Source: `mc_fault_code` in vedderb/bldc `datatypes.h`. Verified identical for codes 0–29 on
 * `release_6_02`, `release_6_05` and `master` (FW 7.01); 30–33 exist on `master` only. Upstream only
 * appends, so a code this table lacks renders as an unknown fault rather than a guess.
 */
const FAULT_CATALOG: Record<number, VescFaultInfo> = {
  0: { title: 'No fault', description: 'The controller reported no fault.' },
  1: {
    title: 'Over voltage',
    description:
      'The controller detected input voltage above its configured maximum. Regenerative braking on a full battery is a common trigger.',
  },
  2: {
    title: 'Under voltage',
    description:
      'The controller detected input voltage below its configured minimum. This can happen when the battery is nearly empty or sags under heavy load.',
  },
  3: {
    title: 'Gate driver fault',
    description:
      'The gate driver chip that switches the motor transistors reported a fault. This points at the controller hardware rather than the battery or motor.',
  },
  4: {
    title: 'Absolute over current',
    description:
      'The controller detected motor current above its absolute current limit. Possible causes include a hard impact, a stalled or shorted motor, or motor settings that do not match the motor.',
  },
  5: {
    title: 'Controller overtemperature',
    description:
      'The controller detected its power transistors (MOSFETs) above their temperature limit.',
  },
  6: {
    title: 'Motor overtemperature',
    description: 'The controller detected motor temperature above its configured limit.',
  },
  7: {
    title: 'Gate driver overvoltage',
    description:
      'The controller detected the supply voltage of its gate driver above the safe range. This concerns the controller hardware.',
  },
  8: {
    title: 'Gate driver undervoltage',
    description:
      'The controller detected the supply voltage of its gate driver below the safe range. This concerns the controller hardware or its supply.',
  },
  9: {
    title: 'MCU undervoltage',
    description:
      'The controller detected the supply voltage of its own processor below the safe range. Possible causes include a deep battery sag or a supply problem on the controller.',
  },
  10: {
    title: 'Watchdog reset',
    description:
      'The controller restarted because its watchdog detected that the firmware stopped responding.',
  },
  11: {
    title: 'Encoder SPI fault',
    description: 'The controller lost communication with the motor position encoder.',
  },
  12: {
    title: 'Sin/cos encoder signal too low',
    description: 'The controller detected the sin/cos encoder signal below its minimum amplitude.',
  },
  13: {
    title: 'Sin/cos encoder signal too high',
    description: 'The controller detected the sin/cos encoder signal above its maximum amplitude.',
  },
  14: {
    title: 'Flash corruption',
    description: 'The controller detected corrupted data in its firmware flash memory.',
  },
  15: {
    title: 'Current sensor 1 offset too high',
    description:
      'The controller measured an unexpectedly high zero-current reading on current sensor 1 at startup.',
  },
  16: {
    title: 'Current sensor 2 offset too high',
    description:
      'The controller measured an unexpectedly high zero-current reading on current sensor 2 at startup.',
  },
  17: {
    title: 'Current sensor 3 offset too high',
    description:
      'The controller measured an unexpectedly high zero-current reading on current sensor 3 at startup.',
  },
  18: {
    title: 'Unbalanced phase currents',
    description:
      'The controller detected currents in the three motor phases that do not add up as expected. Possible causes include a loose phase wire, a damaged motor winding, or a current sensor problem.',
  },
  19: {
    title: 'Hardware brake fault',
    description: 'The controller hardware raised a brake (BRK) fault signal.',
  },
  20: {
    title: 'Resolver loss of tracking',
    description: 'The controller lost tracking of the motor position resolver.',
  },
  21: {
    title: 'Resolver signal degraded',
    description: 'The controller detected a degraded motor position resolver signal.',
  },
  22: {
    title: 'Resolver signal lost',
    description: 'The controller lost the motor position resolver signal.',
  },
  23: {
    title: 'App config corrupted',
    description: 'The controller detected corrupted app configuration data in its flash memory.',
  },
  24: {
    title: 'Motor config corrupted',
    description: 'The controller detected corrupted motor configuration data in its flash memory.',
  },
  25: {
    title: 'Encoder magnet missing',
    description: 'The motor position encoder did not detect its magnet.',
  },
  26: {
    title: 'Encoder magnet too strong',
    description: 'The motor position encoder reported its magnet field as too strong.',
  },
  27: {
    title: 'Phase filter fault',
    description: 'The controller detected a fault in its motor phase voltage filters.',
  },
  28: {
    title: 'Encoder fault',
    description: 'The motor position encoder reported a fault.',
  },
  29: {
    title: 'Low-voltage output fault',
    description: 'The controller detected a fault on its low-voltage accessory output.',
  },
  30: {
    title: 'Encoder slip',
    description:
      'The controller detected that the motor position encoder disagrees with the measured motor position.',
  },
  31: {
    title: 'Overspeed',
    description: 'The controller detected motor speed above its configured maximum.',
  },
  32: {
    title: 'Underspeed',
    description: 'The controller detected motor speed below its configured minimum.',
  },
  33: {
    title: 'Absolute overspeed',
    description: 'The controller detected motor speed above its absolute speed limit.',
  },
}

/** Title and explanation for a controller fault code. Unknown codes keep their number, no guessing. */
export function faultInfo(code: number): VescFaultInfo {
  return (
    FAULT_CATALOG[code] ?? {
      title: `Fault code ${code}`,
      description: 'The controller reported a fault this app does not yet recognize.',
    }
  )
}

/** Undismissed live occurrences drive the VESC Fault icon. */
export function indicatorFaults(faults: VescFaultOccurrence[]): VescFaultOccurrence[] {
  return faults.filter((fault) => !fault.dismissed)
}
