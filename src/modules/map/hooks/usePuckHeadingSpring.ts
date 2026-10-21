import { useHeadingMotionStore } from '@/modules/map/store/headingMotionStore'
import type { SymbolLayer } from '@rnmapbox/maps'
import { useCallback, useEffect, useRef } from 'react'
import { useAppActive } from '@/hooks/useAppActive'
import { PUCK_HEADING_OMEGA } from '@/modules/map/constants/gpsHeadingMotion'
import {
  createSpring,
  nearestBearingTarget,
  normalizeBearing,
  retargetSpring,
  springSettled,
  stepSpring,
  type SpringState,
} from '@/modules/map/lib/cameraEngine/springs'

/** Same critically damped angular spring as the camera, with four times the GPS-heading response speed. */
export function usePuckHeadingSpring(heading: number | null, active = true) {
  const layerRef = useRef<SymbolLayer>(null)
  const spring = useRef<SpringState | null>(null)
  const frame = useRef<number | null>(null)
  const lastTime = useRef(0)
  const appActive = useAppActive()
  const enabled = useRef(false)

  const advance = useCallback(function tick(now: number) {
    frame.current = null
    if (!enabled.current || !spring.current) return
    spring.current = stepSpring(
      spring.current,
      (PUCK_HEADING_OMEGA * useHeadingMotionStore.getState().arrowSpeedPercent) / 100,
      Math.max(0, now - lastTime.current) / 1000,
    )
    lastTime.current = now
    layerRef.current?.setNativeProps({
      style: { iconRotate: normalizeBearing(spring.current.x) },
    })
    if (!springSettled(spring.current, 0.05, 0.05)) {
      frame.current = requestAnimationFrame(tick)
    }
  }, [])

  const setHeading = useCallback(
    (target: number) => {
      if (!Number.isFinite(target) || !enabled.current) return
      spring.current = spring.current
        ? retargetSpring(spring.current, nearestBearingTarget(spring.current.x, target))
        : createSpring(target)
      if (frame.current === null) {
        lastTime.current = performance.now()
        frame.current = requestAnimationFrame(advance)
      }
    },
    [advance],
  )

  useEffect(() => {
    enabled.current = active && appActive
    if (!enabled.current) spring.current = null
    return () => {
      enabled.current = false
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [active, appActive])

  // Restore rotation after a style/source render without resetting angular velocity.
  useEffect(() => {
    if (heading != null) setHeading(heading)
    if (spring.current) {
      layerRef.current?.setNativeProps({
        style: { iconRotate: normalizeBearing(spring.current.x) },
      })
    }
  })

  return { layerRef, setHeading }
}
