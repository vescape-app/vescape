import { useEffect, useState } from 'react'
import { InteractionManager } from 'react-native'

/**
 * Hold expensive work back until the screen has settled: `false` on first render, flipping to
 * `true` once queued interactions (navigation transition, layout, gestures) have finished, plus
 * an optional grace delay. Lets the cheap chrome paint at full frame rate before a heavy child
 * mounts and competes for the JS thread.
 */
export function useDeferredMount(delayMs = 0): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const handle = InteractionManager.runAfterInteractions(() => {
      if (delayMs <= 0) {
        setReady(true)
        return
      }
      timer = setTimeout(() => setReady(true), delayMs)
    })
    return () => {
      handle.cancel()
      if (timer) clearTimeout(timer)
    }
  }, [delayMs])

  return ready
}
