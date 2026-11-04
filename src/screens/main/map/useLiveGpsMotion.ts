import Mapbox from '@rnmapbox/maps'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import { acquireLiveDisplay, liveMotionDisplay } from '@/modules/map/lib/liveMotion/liveDisplay'
import { useEffect, useState } from 'react'

/** A visible renderer subscribes to native segments. Input ownership stays entirely native. */
class PhoneMapDisplay {
  readonly motion = liveMotionDisplay
  readonly pointAnimator = new Mapbox.__experimental.MovePointShapeAnimator(
    MAP_DEFAULTS.fallbackCoordinate,
  )
  active = false
  now = this.motion.now
  duration = this.motion.duration
  subscribe = this.motion.subscribe
  activate(active: boolean) {
    this.active = active
    this.motion.notify()
  }
}
export function useLiveGpsMotion(
  active: boolean,
  fallback: { longitude: number; latitude: number } | null,
) {
  const [runtime] = useState(() => new PhoneMapDisplay())
  useEffect(() => {
    runtime.activate(active)
    if (!active) return
    const release = acquireLiveDisplay()
    return () => {
      runtime.activate(false)
      release()
    }
  }, [active, runtime])
  useEffect(() => {
    if (active && !runtime.motion.position(runtime.now()) && fallback)
      runtime.pointAnimator.moveTo({
        coordinate: [fallback.longitude, fallback.latitude],
        durationMs: 0,
      })
  }, [active, fallback, runtime])
  return runtime
}
export type LiveGpsRuntime = ReturnType<typeof useLiveGpsMotion>
