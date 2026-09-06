import { useEffect, useRef } from 'react'

import { useMapStore } from '@/modules/map/store/mapStore'

/**
 * Frames a freshly computed Navigation path so the rider can judge it before riding it. A path is
 * a decision — is this the way I want to go? — and that decision needs both ends on screen, not the
 * close follow view the map otherwise holds.
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
  const framedPathRef = useRef<number | null>(null)

  useEffect(() => {
    if (!navigation || navigation.coordinates.length < 2) {
      framedPathRef.current = null
      return
    }
    if (!active) {
      framedPathRef.current = null
      return
    }
    if (framedPathRef.current === navigation.computedAtMs) return
    framedPathRef.current = navigation.computedAtMs
    fitRoute(navigation.coordinates as [number, number][])
  }, [active, fitRoute, navigation])
}
