/** Adapt a high-rate native publisher to a bounded diagnostic refresh cadence. */
export function subscribeThrottled(
  subscribe: (listener: () => void) => () => void,
  listener: () => void,
  intervalMs: number,
  now: () => number = () => performance.now(),
  schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = subscribe(() => {
    const current = now()
    const remaining = intervalMs - (current - last)
    if (remaining <= 0) {
      last = current
      listener()
    } else if (timer == null) {
      timer = schedule(() => {
        timer = null
        last = now()
        listener()
      }, remaining)
    }
  })
  return () => {
    unsubscribe()
    if (timer != null) cancel(timer)
  }
}
