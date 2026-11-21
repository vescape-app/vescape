import { useEffect, useState } from 'react'

const MINUTE_MS = 60_000
const BOUNDARY_SLACK_MS = 50

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
