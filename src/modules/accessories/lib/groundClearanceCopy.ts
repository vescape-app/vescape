import type {
  AccessoryReadingStatus,
  GroundClearanceDirection,
  GroundClearanceProblem,
} from 'vescape-core'

/**
 * Rider-facing phrasing for the ground-clearance capability. Native decides; this only phrases it.
 *
 * Nothing here re-derives a verdict. Validity, sample status and measurement demand are all decided
 * natively — a second definition of "valid" in JS could disagree with the one the binding actually
 * uses, and the rider would be told the calibration is fine while the board refuses to act on it.
 */

/** How a sample reads to the rider, with whether it is a number at all. */
export interface ReadingCopy {
  /** The measured distance, or a short phrase when there is none. */
  value: string
  /** Present only when the reading is not a measurement. */
  detail?: string
  tone: 'success' | 'caution'
}

/**
 * One sample as a line of text.
 *
 * `out_of_range` and `error` never borrow a number — not the last good one, not the top of the
 * declared range. The whole safety property of this feature is that a missing measurement is not a
 * distance, and a screen that filled the gap with the previous reading would be the first place
 * that stops being true.
 */
export function readingCopy(status: AccessoryReadingStatus, valueCm: number | null): ReadingCopy {
  if (status === 'ok' && valueCm != null) {
    return { value: `${valueCm.toFixed(1)} cm`, tone: 'success' }
  }
  if (status === 'out_of_range') {
    return {
      value: '—',
      detail: 'Nothing in range. Point the sensor at the ground from a mounted position.',
      tone: 'caution',
    }
  }
  return {
    value: '—',
    detail: 'The sensor could not measure. Check that it is connected and unobstructed.',
    tone: 'caution',
  }
}

/** Why native did not accept a calibration, in rider language. */
export function calibrationProblemCopy(
  problem: GroundClearanceProblem | 'unknown-capability' | 'storage-unavailable' | (string & {}),
): string {
  switch (problem) {
    case 'near-not-below-far':
      return 'The near distance has to be smaller than the far distance — less clearance means more correction.'
    case 'outside-declared-range':
      return 'These distances are outside what the sensor says it can measure. Move them inside its range.'
    case 'strength-out-of-bounds':
      return 'Strength has to be between 1% and 100%. At 0% the binding would command nothing.'
    case 'unknown-direction':
      return 'This mounting position was saved by a newer version of Vescape and cannot be used here.'
    case 'not-a-number':
      return 'One of these distances is not a number. Set them again.'
    case 'unknown-capability':
      return 'This accessory is no longer saved on this phone.'
    case 'storage-unavailable':
      return 'Vescape could not save this. Nothing was changed; try again.'
    default:
      return problem
  }
}

/** What each mounting position means for the rider, beside its label. */
export function directionCopy(direction: GroundClearanceDirection): string {
  return direction === 'nose'
    ? 'The sensor is mounted at the nose. Losing clearance there lifts the nose.'
    : 'The sensor is mounted at the tail. Losing clearance there lifts the tail.'
}
