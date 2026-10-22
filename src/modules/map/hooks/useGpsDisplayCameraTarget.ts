import { useEffect } from 'react'
import type { GpsDisplayMotion } from 'vescape-core'
import { gpsDisplayPosition } from '@/modules/map/lib/gpsDisplayMotion'

/** Feed a display position into a camera spring without publishing per-frame React state. */
export function useGpsDisplayCameraTarget(
  motion: GpsDisplayMotion | null | undefined,
  active: boolean,
  onTarget: (coordinate: [number, number]) => boolean,
) {
  useEffect(() => {
    if (!active || !motion) return
    let frame: number | null = null
    const update = () => {
      const now = Date.now()
      if (!onTarget(gpsDisplayPosition(motion, now))) return
      const moving = (motion.latitudePerMs ?? 0) !== 0 || (motion.longitudePerMs ?? 0) !== 0
      const endsAt = Math.max(motion.endsAtMs, moving ? (motion.velocityExpiresAtMs ?? 0) : 0)
      if (now < endsAt) frame = requestAnimationFrame(update)
    }
    update()
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [active, motion, onTarget])
}
