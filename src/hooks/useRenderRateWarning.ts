import { useEffect, useRef } from 'react'

import { captureMode } from '@/config/env'

const WINDOW_MS = 1_000
const DEFAULT_THRESHOLD = 5

/**
 * Dev-only canary: warns when a component commits more than `threshold` renders
 * per second. Guards against high-frequency render regressions — e.g. a sensor
 * stream (magnetometer, BLE) driving React state and re-rendering a heavy
 * subtree, which pins CPU/GPU and overheats the device. No-op in production,
 * and in screenshot mode, where a debug-build capture run must stay clean.
 */
export function useRenderRateWarning(label: string, threshold = DEFAULT_THRESHOLD): void {
  const countRef = useRef(0)

  // One increment per committed render.
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
