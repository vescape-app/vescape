import { useEffect, useRef } from 'react'

import { captureMode } from '@/config/env'

const WINDOW_MS = 1_000
const DEFAULT_THRESHOLD = 5

export function useRenderRateWarning(label: string, threshold = DEFAULT_THRESHOLD): void {
  const countRef = useRef(0)

  useEffect(() => {
    countRef.current += 1
  })

  useEffect(() => {
    if (!__DEV__ || captureMode) return
    const id = setInterval(() => {
      const count = countRef.current
      countRef.current = 0
      if (count > threshold) {
        console.warn(
          `[renderRate] ${label} committed ${count} renders in ${WINDOW_MS}ms (>${threshold}/s)`,
        )
      }
    }, WINDOW_MS)
    return () => clearInterval(id)
  }, [label, threshold])
}
