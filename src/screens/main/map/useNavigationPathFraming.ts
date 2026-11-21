import { useEffect, useRef } from 'react'

import {
  navigationFrameDecision,
  type NavigationPathFrame,
} from '@/modules/map/lib/navigationPathFraming'
import { navigationCameraPath } from '@/modules/map/lib/navigationPath'
import { useMapStore } from '@/modules/map/store/mapStore'

export function useNavigationPathFraming({
  active,
  fitRoute,
}: {
  active: boolean
  fitRoute: (route: [number, number][]) => void
}) {
  const navigation = useMapStore((s) => s.navigation)
  const hasProjection = useMapStore(
    (s) => s.routeProgress != null && s.routeProgress.navigationRevision === s.navigation?.revision,
  )
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
    const progress = useMapStore.getState().routeProgress
    const route = navigationCameraPath(navigation, progress)
    if (route.length === 0) return
    fitRoute(route)
  }, [active, fitRoute, navigation, hasProjection])
}
