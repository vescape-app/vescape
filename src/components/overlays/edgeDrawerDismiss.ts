export const DRAWER_INITIAL_OPEN_FRACTION = 0.75
export const COMMIT_FRACTION = 0.45

export interface EdgeDrawerGeometry {
  offset: number
  range: number
  height: number
  opensFromTop: boolean
}

function clamp(value: number, min: number, max: number) {
  'worklet'
  return Math.max(min, Math.min(max, value))
}

export function edgeDrawerOnScreenPixels({
  offset,
  range,
  height,
  opensFromTop,
}: EdgeDrawerGeometry) {
  'worklet'
  return clamp(opensFromTop ? range - offset : offset, 0, height)
}

export function edgeDrawerRestingPixels(range: number, height: number, opensFromTop: boolean) {
  'worklet'
  return Math.min(range, opensFromTop ? height : height * DRAWER_INITIAL_OPEN_FRACTION)
}

export function edgeDrawerVisibleFraction(geometry: EdgeDrawerGeometry) {
  'worklet'
  const resting = edgeDrawerRestingPixels(geometry.range, geometry.height, geometry.opensFromTop)
  if (resting <= 0) return 0
  return clamp(edgeDrawerOnScreenPixels(geometry) / resting, 0, 1)
}

const FADE_KNEE_FRACTION = 0.9
const FADE_KNEE_OPACITY = 0.7

export function edgeDrawerDismissOpacity(visibleFraction: number) {
  'worklet'
  const left = clamp(visibleFraction, 0, 1)
  if (left >= FADE_KNEE_FRACTION) {
    const intoKick = (1 - left) / (1 - FADE_KNEE_FRACTION)
    return 1 - intoKick * (1 - FADE_KNEE_OPACITY)
  }
  const intoTail = (left - COMMIT_FRACTION) / (FADE_KNEE_FRACTION - COMMIT_FRACTION)
  return clamp(intoTail, 0, 1) * FADE_KNEE_OPACITY
}

export function edgeDrawerHasCommitted(visibleFraction: number) {
  'worklet'
  return visibleFraction <= COMMIT_FRACTION
}

export function edgeDrawerRestoreOffset(
  range: number,
  height: number,
  opensFromTop: boolean,
): number {
  'worklet'
  const target = edgeDrawerRestingPixels(range, height, opensFromTop)
  return clamp(opensFromTop ? range - target : target, 0, range)
}

export type EdgeDrawerScrollEndAction = 'finish' | 'close' | 'restore' | 'stay-open'

interface EdgeDrawerScrollEndState {
  fullyHidden: boolean
  visibleFraction: number
}

export function edgeDrawerScrollEndAction({
  fullyHidden,
  visibleFraction,
}: EdgeDrawerScrollEndState): EdgeDrawerScrollEndAction {
  if (fullyHidden) return 'finish'
  if (edgeDrawerHasCommitted(visibleFraction)) return 'close'
  if (visibleFraction < 1) return 'restore'
  return 'stay-open'
}

export function edgeDrawerContentResizeOffset({
  offset,
  range,
  previousRange,
  height,
}: {
  offset: number
  range: number
  previousRange: number
  height: number
}): number {
  const grown = range > previousRange ? offset + (range - previousRange) : offset
  const wasOpaque = offset >= edgeDrawerRestoreOffset(previousRange, height, false)
  const pinned = wasOpaque ? Math.max(grown, edgeDrawerRestoreOffset(range, height, false)) : grown
  return clamp(pinned, 0, range)
}

export function edgeDrawerOpaqueFloorOffset({
  offset,
  range,
  previousRange,
  height,
}: {
  offset: number
  range: number
  previousRange: number
  height: number
}): number {
  const wasOpaque = offset >= edgeDrawerRestoreOffset(previousRange, height, false) - 1
  if (!wasOpaque) return offset
  return Math.max(offset, edgeDrawerRestoreOffset(range, height, false))
}

export function edgeDrawerFocusOffset({
  offset,
  itemHeight,
  range,
  height,
  opensFromTop,
}: {
  offset: number
  itemHeight: number
  range: number
  height: number
  opensFromTop: boolean
}): number {
  const minimum = opensFromTop ? 0 : Math.min(range, height * DRAWER_INITIAL_OPEN_FRACTION)
  return Math.max(minimum, Math.min(range, offset + itemHeight / 2 - height / 2))
}

const DISMISS_EDGE_SLOP = 8

export function edgeDrawerDragStartsAtEdge({
  offset,
  range,
  height,
  opensFromTop,
}: EdgeDrawerGeometry) {
  'worklet'
  if (range <= height) return true
  return opensFromTop
    ? offset >= range - height - DISMISS_EDGE_SLOP
    : offset <= height + DISMISS_EDGE_SLOP
}

export function edgeDrawerPastEdge({ offset, range, height, opensFromTop }: EdgeDrawerGeometry) {
  'worklet'
  const edge = edgeDrawerRestoreOffset(range, height, opensFromTop)
  return opensFromTop ? offset > edge + 1 : offset < edge - 1
}

export function edgeDrawerStickyShift({
  offset,
  start,
  end,
  pinAt,
  maxShift,
}: {
  offset: number
  pinAt: number
  maxShift: number
} & ({ start: number; end?: never } | { end: number; start?: never })) {
  'worklet'
  const limit = Math.max(0, maxShift)
  if (start !== undefined) return clamp(offset + pinAt - start, 0, limit)
  return -clamp(end - offset - pinAt, 0, limit)
}
