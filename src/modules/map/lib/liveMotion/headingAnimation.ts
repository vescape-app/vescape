import {
  createSpring,
  nearestBearingTarget,
  retargetSpring,
  springSettled,
  stepSpring,
} from '../cameraEngine/springs'

/** Rotation belongs to the mounted arrow; retain its angle across orientation changes. */
export function startHeadingAnimation({
  angle,
  heading,
  omega,
  draw,
  subscribe,
  isActive,
  now,
  schedule,
  cancel,
}: {
  angle: { current: number }
  heading: () => number | null
  omega: () => number
  draw: (angle: number) => void
  subscribe: (listener: () => void) => () => void
  isActive: () => boolean
  now: () => number
  schedule: (callback: (now: number) => void) => number
  cancel: (frame: number) => void
}) {
  let spring = createSpring(angle.current)
  let frame: number | null = null
  let last = now()
  const animate = (at: number) => {
    frame = null
    if (!isActive()) return
    spring = stepSpring(spring, omega(), Math.min(0.064, (at - last) / 1000))
    last = at
    angle.current = spring.x
    draw(spring.x)
    if (!springSettled(spring, 0.05, 0.05)) frame = schedule(animate)
  }
  const update = () => {
    if (!isActive()) {
      if (frame != null) cancel(frame)
      frame = null
      return
    }
    const bearing = heading()
    if (bearing == null) return
    const target = nearestBearingTarget(spring.x, bearing)
    if (target === spring.target && springSettled(spring, 0.05, 0.05)) return
    spring = retargetSpring(spring, target)
    if (frame == null) {
      last = now()
      frame = schedule(animate)
    }
  }
  const unsubscribe = subscribe(update)
  // A remounted native layer has its declarative initial angle, even if no animation is needed.
  if (isActive()) draw(angle.current)
  update()
  return () => {
    unsubscribe()
    if (frame != null) cancel(frame)
  }
}
