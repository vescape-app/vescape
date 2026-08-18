import { useEffect, useRef, useState } from 'react'

import {
  glideDurationMs,
  interpolateFix,
  type FixCoordinate,
} from '@/modules/map/lib/fixInterpolation'

/**
 * Renders a GPS fix stream as continuous motion instead of a step every time a fix lands.
 *
 * Fixes arrive about once a second — that is the cadence of the hardware and of a recording of it,
 * not something the app chooses — so anything drawn straight from the newest fix teleports once a
 * second and stands still in between. This eases the *rendered* position across each gap at frame
 * rate, leaving the fixes themselves untouched: the trail, the recording and Ride History keep the
 * measured positions, and only what the rider watches is smoothed.
 *
 * The first fix lands directly; there is nothing to travel from, and easing in from a stale position
 * would drag the puck across the map on connect.
 */
/**
 * How long the current glide lasts, for anything that has to move in step with the puck without
 * being the puck — the follow camera above all.
 *
 * Measured from arrival, not from the timestamps the fixes carry. A replay at speed hands over
 * fixes stamped a second apart within milliseconds of each other; pacing anything to those stamps
 * would leave it a long way behind what is actually on screen.
 */
export function useSmoothedFix<T extends FixCoordinate>(fix: T | null): T | null {
  const [smoothed, setSmoothed] = useState<T | null>(fix)
  const fromRef = useRef<FixCoordinate | null>(null)
  const previousFixAtRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    // Every path defers to a frame rather than setting state during the effect: a synchronous set
    // here re-renders the whole map tree before paint, once per fix.
    if (fix == null) {
      fromRef.current = null
      previousFixAtRef.current = null
      frameRef.current = requestAnimationFrame(() => setSmoothed(null))
      return () => {
        if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
    const from = fromRef.current
    const startedAt = Date.now()
    const durationMs = glideDurationMs(previousFixAtRef.current, startedAt)
    previousFixAtRef.current = startedAt
    if (from == null) {
      fromRef.current = { latitude: fix.latitude, longitude: fix.longitude }
      frameRef.current = requestAnimationFrame(() => setSmoothed(fix))
      return () => {
        if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }

    const step = () => {
      const t = (Date.now() - startedAt) / durationMs
      const at = interpolateFix(from, fix, t)
      fromRef.current = at
      // Carry the rest of the fix through untouched — accuracy, speed and timestamp describe the
      // measurement, and interpolating them would invent readings the receiver never took.
      setSmoothed({ ...fix, latitude: at.latitude, longitude: at.longitude })
      if (t < 1) frameRef.current = requestAnimationFrame(step)
    }
    frameRef.current = requestAnimationFrame(step)
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [fix])

  return smoothed
}
