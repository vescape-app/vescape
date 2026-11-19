import { useEffect, useState } from 'react'

const MINUTE_MS = 60_000
/** Lands a tick just past the boundary, so a timer that fires a hair early still crosses it. */
const BOUNDARY_SLACK_MS = 50

/**
 * Current time, refreshed once a minute while enabled — paces relative-age labels.
 * With an `anchor`, it ticks on the anchor's minute boundaries instead, so a countdown to it
 * steps down the moment its minute passes.
 */
export function useMinuteNow(enabled = true, anchor: number | null = null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    if (anchor == null) {
      const id = setInterval(() => setNow(Date.now()), MINUTE_MS)
      return () => clearInterval(id)
    }
    let id: ReturnType<typeof setTimeout>
    const schedule = () => {
      const untilBoundary = (((anchor - Date.now()) % MINUTE_MS) + MINUTE_MS) % MINUTE_MS
      id = setTimeout(() => {
        setNow(Date.now())
        schedule()
      }, untilBoundary + BOUNDARY_SLACK_MS)
    }
    schedule()
    return () => clearTimeout(id)
  }, [enabled, anchor])
  return now
}
