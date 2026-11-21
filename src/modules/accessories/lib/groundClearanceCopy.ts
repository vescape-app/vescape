import type {
  AccessoryReadingStatus,
  GroundClearanceDirection,
  GroundClearanceProblem,
} from 'vescape-core'

export interface ReadingCopy {
  value: string
  detail?: string
  tone: 'success' | 'caution'
}

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

export function directionCopy(direction: GroundClearanceDirection): string {
  return direction === 'nose'
    ? 'The sensor is mounted at the nose. Losing clearance there lifts the nose.'
    : 'The sensor is mounted at the tail. Losing clearance there lifts the tail.'
}
