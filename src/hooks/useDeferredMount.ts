import { useEffect, useState } from 'react'

/**
 * Hold expensive work back until the screen has settled: `false` on first render, flipping to
 * `true` after the next frame has been painted, plus an optional grace delay. Lets the cheap
 * chrome paint at full frame rate before a heavy child mounts and competes for the JS thread.
 */
export function useDeferredMount(delayMs = 0): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const frame = requestAnimationFrame(() => {
      if (delayMs <= 0) {
        setReady(true)
        return
      }
      timer = setTimeout(() => setReady(true), delayMs)
    })
    return () => {
      cancelAnimationFrame(frame)
      if (timer) clearTimeout(timer)
    }
  }, [delayMs])

  return ready
}
