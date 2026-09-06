import type Mapbox from '@rnmapbox/maps'
import { useCallback, useRef, useState, type ComponentRef } from 'react'
import type { LayoutChangeEvent } from 'react-native'

import type { MapLayout } from '@/screens/main/map/offscreenMapIndicators'

export function useMapViewport() {
  const mapViewRef = useRef<ComponentRef<typeof Mapbox.MapView> | null>(null)
  const [mapLayout, setMapLayout] = useState<MapLayout>({ width: 0, height: 0 })

  const handleMapLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setMapLayout((current) =>
      Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
        ? current
        : { width, height },
    )
  }, [])

  const getViewfinderCoordinateFromMap = useCallback(async () => {
    const mapView = mapViewRef.current
    if (!mapView || mapLayout.width <= 0 || mapLayout.height <= 0) return null

    const coordinate = await mapView.getCoordinateFromView([
      mapLayout.width / 2,
      mapLayout.height / 2,
    ])
    const [longitude, latitude] = coordinate
    if (typeof longitude !== 'number' || typeof latitude !== 'number') return null
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
    return { longitude, latitude }
  }, [mapLayout.height, mapLayout.width])

  return { mapViewRef, mapLayout, handleMapLayout, getViewfinderCoordinateFromMap }
}
