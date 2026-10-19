import { useEffect, useRef } from 'react'

import { navigationCameraPath } from '@/modules/map/lib/navigationPath'
import { useMapStore } from '@/modules/map/store/mapStore'

/**
 * Frames the remaining Navigation from the native projection to the destination. Passed sections
 * stay dimmed on the map but must not pull the camera back to where the rider has already been.
 *
 * Fires once per map visit and computed path, keyed on `computedAtMs`: opening the route preview,
 * a recompute or a Profile switch reframes, while a rider panning afterwards is left alone. A path
 * arriving in telemetry mode must not move the camera under a rider who is looking at their speed.
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
  const framedPathRef = useRef<{ computedAtMs: number; projected: boolean } | null>(null)

  useEffect(() => {
    if (!navigation || navigation.coordinates.length < 2) {
      framedPathRef.current = null
      return
    }
    if (!active) {
      framedPathRef.current = null
      return
    }
    const framed = framedPathRef.current
    if (framed?.computedAtMs === navigation.computedAtMs && (framed.projected || !hasProjection))
      return
    // Read the latest position at entry, without reframing or subscribing to every moving fix.
    const progress = useMapStore.getState().routeProgress
    const route = navigationCameraPath(navigation, progress)
    if (route.length === 0) return
    framedPathRef.current = { computedAtMs: navigation.computedAtMs, projected: progress != null }
    fitRoute(route)
  }, [active, fitRoute, navigation, hasProjection])
}
