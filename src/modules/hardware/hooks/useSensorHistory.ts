import { useEffect, useState } from 'react'

import { frameVersion, keySetVersion, readKeys } from '@/modules/hardware/lib/sensorLog'

/**
 * How often the charts are rebuilt. Four redraws a second reads as continuous on a scrolling
 * chart, and it decouples the drawing cost from a link that can push fifty frames a second.
 */
const CHART_POLL_MS = 250

/** How often the row list is checked for a new sensor. Keys change when hardware is plugged in. */
const KEYS_POLL_MS = 1000

/** Ticks when there are new frames to draw, at the chart's pace rather than the link's. */
export function useChartVersion(): number {
  const [version, setVersion] = useState(frameVersion)
  useEffect(() => {
    const id = setInterval(() => setVersion(frameVersion()), CHART_POLL_MS)
    return () => clearInterval(id)
  }, [])
  return version
}

/**
 * Keys the board has sent on this link. Only the set is reactive: the values behind these keys
 * live in shared values, so a row appears through React and then updates without it.
 */
export function useSensorKeys(): readonly string[] {
  const [state, setState] = useState(() => ({ v: keySetVersion(), keys: readKeys() }))
  useEffect(() => {
    const id = setInterval(() => {
      setState((prev) =>
        prev.v === keySetVersion() ? prev : { v: keySetVersion(), keys: readKeys() },
      )
    }, KEYS_POLL_MS)
    return () => clearInterval(id)
  }, [])
  return state.keys
}
