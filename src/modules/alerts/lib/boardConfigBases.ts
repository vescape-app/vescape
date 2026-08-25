import type { BoardConfigBases } from '@/modules/alerts/lib/configRelativeFields'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'
import { useMotorConfigValuesStore } from '@/modules/board/store/motorConfigValuesStore'

/**
 * Both of the board's configs in the shape the Alert Preset generator anchors against.
 *
 * Two readers: {@link useBoardConfigBases} for components, and {@link readBoardConfigBases} for the
 * preset store, which regenerates rules outside React. They must agree, so the shaping lives here.
 */
export function boardConfigBases(
  refloat: Record<string, number | boolean> | undefined,
  motor: Record<string, number> | undefined,
): BoardConfigBases {
  return { refloat: numbersOnly(refloat), motor: motor ?? null }
}

/** A one-shot snapshot for callers that are not components. */
export function readBoardConfigBases(): BoardConfigBases {
  const refloat = useBoardConfigValuesStore.getState().values?.values
  const motorState = useMotorConfigValuesStore.getState()
  return boardConfigBases(refloat, (motorState.values ?? motorState.lastKnown)?.values)
}

/** Refloat carries booleans too; a config-relative anchor is only ever a number. */
function numbersOnly(
  values: Record<string, number | boolean> | undefined,
): Record<string, number> | null {
  if (!values) return null
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>
}
