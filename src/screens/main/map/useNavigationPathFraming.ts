import { useEffect, useRef } from 'react'

import {
  navigationFrameDecision,
  type NavigationPathFrame,
} from '@/modules/map/lib/navigationPathFraming'
import { navigationCameraPath } from '@/modules/map/lib/navigationPath'
import { useMapStore } from '@/modules/map/store/mapStore'

/**
 * Frames the remaining Navigation from the native projection to the destination. Passed sections
 * stay dimmed on the map but must not pull the camera back to where the rider has already been.
 *
 * Frames once per map visit and native `cameraRevision`: opening the route preview,
 * a recompute or a Profile switch reframes, while a rider panning afterwards is left alone. A path
 * arriving in telemetry mode must not move the camera under a rider who is looking at their speed.
 * Automatic replacements retain the revision and never change an already open map’s camera.
 */
export function useNavigationPathFraming({
  active,
  fitRoute,
}: {
  active: boolean
  fitRoute: (route: [number, number][]) => void
}) {
  const navigation = useMapStore((s) => s.navigation)
  const hasProjection = useMapStore((s) => s.routeProgress != null)
  const framedPathRef = useRef<NavigationPathFrame | null>(null)

  useEffect(() => {
    if (!navigation || navigation.coordinates.length < 2) {
      framedPathRef.current = null
      return
    }
    if (!active) {
      framedPathRef.current = null
      return
    }
    const decision = navigationFrameDecision(framedPathRef.current, navigation, hasProjection)
    framedPathRef.current = decision.state
    if (!decision.frame) return
    // Read the latest position at entry, without reframing or subscribing to every moving fix.
    const progress = useMapStore.getState().routeProgress
    const route = navigationCameraPath(navigation, progress)
    if (route.length === 0) return
    fitRoute(route)
  }, [active, fitRoute, navigation, hasProjection])
}
