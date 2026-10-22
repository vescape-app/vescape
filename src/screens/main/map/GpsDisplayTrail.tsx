import { useEffect, useState } from 'react'
import { useAppActive } from '@/hooks/useAppActive'
import { useLocationStore } from '@/modules/location/store/locationStore'
import { GpsDisplayTrailLayer } from '@/modules/map/components/GpsDisplayTrailLayer'
import {
  DISPLAY_TRAIL_SAMPLE_MS,
  GpsDisplayTrail as Trail,
} from '@/modules/map/lib/gpsDisplayTrail'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'

/** Only this debug layer re-renders; the map and puck keep their native animation cadence. */
export function GpsDisplayTrail() {
  const enabled = useNavigationDiagnosticsStore((s) => s.showDisplayTrail)
  return enabled ? <ActiveDisplayTrail /> : null
}

function ActiveDisplayTrail() {
  const active = useAppActive()
  const [trail] = useState(() => new Trail())
  const [shape, setShape] = useState<GeoJSON.Feature<GeoJSON.MultiLineString> | null>(null)
  useEffect(() => {
    if (!active) {
      trail.pause()
      return
    }
    let lastPublished = 0
    const sample = () => {
      const now = Date.now()
      trail.sample(useLocationStore.getState().displayMotion, now)
      // Sample at 20 Hz, send one bounded geometry to Mapbox at 2 Hz.
      if (now - lastPublished >= 500) {
        setShape(trail.shape())
        lastPublished = now
      }
    }
    sample()
    const timer = setInterval(sample, DISPLAY_TRAIL_SAMPLE_MS)
    return () => {
      clearInterval(timer)
      trail.pause()
    }
  }, [active, trail])
  return <GpsDisplayTrailLayer shape={shape} />
}
