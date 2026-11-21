import { useEffect, useState } from 'react'

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
