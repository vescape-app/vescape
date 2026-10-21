import Mapbox from '@rnmapbox/maps'
import { useEffect, useState } from 'react'
import type { GpsDisplayMotion } from 'vescape-core'

import { gpsDisplayPosition } from '@/modules/map/lib/gpsDisplayMotion'
import { GpsDisplayAnimatorController } from '@/modules/map/lib/gpsDisplayAnimator'

export type GpsDisplayAnimator = InstanceType<typeof Mapbox.__experimental.MovePointShapeAnimator>

/** Native point animation: one segment command per GPS fix, no frame events through JS. */
export function useGpsDisplayAnimator(
  motion: GpsDisplayMotion | null | undefined,
  active: boolean,
) {
  const [animator] = useState(
    () =>
      new Mapbox.__experimental.MovePointShapeAnimator(
        motion ? gpsDisplayPosition(motion, Date.now()) : [0, 0],
      ),
  )
  const [controller] = useState(() => new GpsDisplayAnimatorController(animator))
  useEffect(() => {
    controller.update(motion, active, Date.now())
    // Final source unsubscription stops native animation. Never snap on a per-model cleanup.
  }, [active, controller, motion])
  return motion ? animator : null
}
