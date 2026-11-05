import type { MotionDisplay } from './display'

/** Thin adapter for the existing linear native animator. No renderer-side motion/rebasing math. */
export function startPointAnimation({
  motion,
  moveTo,
  subscribe,
  now,
  isActive = () => true,
  schedule,
  cancel,
}: {
  motion: MotionDisplay
  moveTo: (coordinate: [number, number], durationMs: number) => void
  subscribe: (listener: () => void) => () => void
  now: () => number
  isActive?: () => boolean
  schedule: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  cancel: (timer: ReturnType<typeof setTimeout>) => void
}) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let revision: number | null = null
  let wasActive = false
  function update() {
    if (timer != null) cancel(timer)
    timer = null
    if (!isActive()) {
      if (wasActive) {
        const coordinate = motion.position(now())
        if (coordinate) moveTo(coordinate, 0)
      }
      wasActive = false
      return
    }
    wasActive = true
    const segment = motion.segment(now())
    if (!segment.from || !segment.to) return
    if (revision !== segment.revision) {
      moveTo(segment.from, 0)
      revision = segment.revision
    }
    moveTo(segment.to, segment.durationMs)
    if (segment.durationMs > 0) timer = schedule(update, segment.durationMs)
  }
  const unsubscribe = subscribe(update)
  update()
  return () => {
    unsubscribe()
    if (timer != null) cancel(timer)
    const position = motion.position(now())
    if (position) moveTo(position, 0)
  }
}
