/**
 * The dismissal math for {@link EdgeDrawer}, kept pure so the UI-thread worklets and the JS scroll
 * handlers read a single formula.
 *
 * A drawer is dismissed by scrolling it back toward the edge it opened from. The quantity that
 * matters is how much of the drawer is still *on screen* — not how much scrolling is left, which on
 * a long article is thousands of points while the drawer sits perfectly still at full size. Every
 * mark below is therefore a fraction of the drawer's resting on-screen presence, so a three-screen
 * article, a half-screen panel, and a top or bottom edge all dismiss with the same feel.
 */

/** How much of the screen a bottom drawer shows when it first opens. */
export const DRAWER_INITIAL_OPEN_FRACTION = 0.75
/** Below this much of the drawer left on screen the dismissal commits: it closes, never settles. */
export const COMMIT_FRACTION = 0.45

export interface EdgeDrawerGeometry {
  /** Current scroll offset. */
  offset: number
  /** Maximum scroll offset — the drawer's full dismissal travel. */
  range: number
  /** Screen height. */
  height: number
  opensFromTop: boolean
}

function clamp(value: number, min: number, max: number) {
  'worklet'
  return Math.max(min, Math.min(max, value))
}

/** Drawer points on screen at a given scroll offset, capped at what the screen can show. */
export function edgeDrawerOnScreenPixels({
  offset,
  range,
  height,
  opensFromTop,
}: EdgeDrawerGeometry) {
  'worklet'
  return clamp(opensFromTop ? range - offset : offset, 0, height)
}

/**
 * Drawer points on screen at the opening position. A top drawer fills the screen (or is capped by
 * its own height); a bottom drawer deliberately opens partway, and that partial view is its rest.
 */
export function edgeDrawerRestingPixels(range: number, height: number, opensFromTop: boolean) {
  'worklet'
  return Math.min(range, opensFromTop ? height : height * DRAWER_INITIAL_OPEN_FRACTION)
}

/** How much of the drawer is left: 1 at the opening position, 0 once it is off screen. */
export function edgeDrawerVisibleFraction(geometry: EdgeDrawerGeometry) {
  'worklet'
  const resting = edgeDrawerRestingPixels(geometry.range, geometry.height, geometry.opensFromTop)
  if (resting <= 0) return 0
  return clamp(edgeDrawerOnScreenPixels(geometry) / resting, 0, 1)
}

/** How much of the drawer leaving the screen counts as the opening kick of the fade. */
const FADE_KNEE_FRACTION = 0.9
/** Opacity that kick lands on. */
const FADE_KNEE_OPACITY = 0.7

/**
 * Panel opacity for a dismissal in progress, as a function of how much of the drawer is left.
 *
 * The fade runs from fully present to transparent exactly at the commit mark: crossing that mark is
 * the moment the drawer is gone, so it should arrive there having already faded out, not still at a
 * third opacity that a timed animation then has to mop up.
 *
 * Two straight segments meeting at a knee, because the two things wanted here pull apart and a
 * single curve cannot do both. A steep curve answers the start of the drag but is near zero a
 * quarter of the way in, leaving most of the gesture with nothing to see — which reads as the drawer
 * disappearing instantly. A straight line stays visible throughout but its opening is too gentle to
 * register. So: a short steep segment that buys real transparency for the first tenth of the
 * departure, then a long gentle one spread across everything up to the commit mark.
 */
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

/** Whether a drawer at this point of its travel is past saving. */
export function edgeDrawerHasCommitted(visibleFraction: number) {
  'worklet'
  return visibleFraction <= COMMIT_FRACTION
}

/** The offset a half-faded drawer settles back to — the first offset that is fully opaque again. */
export function edgeDrawerRestoreOffset(
  range: number,
  height: number,
  opensFromTop: boolean,
): number {
  const target = edgeDrawerRestingPixels(range, height, opensFromTop)
  return clamp(opensFromTop ? range - target : target, 0, range)
}

/**
 * `finish` unmounts outright, `close` plays the dismissal fade from where scrolling left off, and
 * `restore` settles a half-faded drawer back to full opacity.
 */
export type EdgeDrawerScrollEndAction = 'finish' | 'close' | 'restore' | 'stay-open'

interface EdgeDrawerScrollEndState {
  fullyHidden: boolean
  visibleFraction: number
}

/** Decide how the drawer settles when native scrolling or a user drag ends. */
export function edgeDrawerScrollEndAction({
  fullyHidden,
  visibleFraction,
}: EdgeDrawerScrollEndState): EdgeDrawerScrollEndAction {
  if (fullyHidden) return 'finish'
  if (edgeDrawerHasCommitted(visibleFraction)) return 'close'
  if (visibleFraction < 1) return 'restore'
  return 'stay-open'
}

/**
 * Where a bottom drawer's scroll offset belongs after its content changed size.
 *
 * Offset *is* visible presence for a bottom drawer, so content growing under it would read as the
 * drawer retreating toward its edge and fade it out with no gesture left to bring it back. Growth
 * is therefore absorbed into the offset (the drawer stays pinned to its own edge).
 *
 * The fully-opaque floor only applies to a drawer that was already opaque. A drawer the user is
 * dragging toward dismissal is deliberately below that mark, and a resize landing mid-drag must not
 * snap it back up under the finger. Shrinking needs no absorption beyond the clamp to the new
 * range: the native clamp already walks the offset down with the content end.
 */
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
