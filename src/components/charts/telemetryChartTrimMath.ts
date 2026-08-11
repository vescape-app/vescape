export type TrimHandle = 0 | 1

/** The selected range is two generous drag targets split at its midpoint. */
export function pickTrimHandle(touchX: number, startX: number, endX: number): TrimHandle {
  'worklet'
  return touchX <= startX + (endX - startX) / 2 ? 0 : 1
}

/**
 * Move one trim edge by gesture translation rather than absolute touch position, so grabbing
 * anywhere in that edge's half of the selection never snaps the handle under the finger.
 */
export function moveTrimHandle({
  handle,
  originMs,
  translationX,
  chartWidth,
  domainStartMs,
  domainEndMs,
  oppositeMs,
}: {
  handle: TrimHandle
  originMs: number
  translationX: number
  chartWidth: number
  domainStartMs: number
  domainEndMs: number
  oppositeMs: number
}): number {
  'worklet'
  const span = domainEndMs - domainStartMs
  const translatedMs = originMs + (translationX / chartWidth) * span
  return handle === 0
    ? Math.max(domainStartMs, Math.min(oppositeMs, translatedMs))
    : Math.min(domainEndMs, Math.max(oppositeMs, translatedMs))
}
