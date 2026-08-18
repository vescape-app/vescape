import type Mapbox from '@rnmapbox/maps'
import { useCallback, useEffect, useRef, type ComponentRef, type RefObject } from 'react'

import {
  coordinateSelection,
  placeSelectionFromFeatures,
  type MapSelection,
} from '@/modules/map/lib/mapSelection'

const SELECTABLE_BASE_MAP_LAYER_IDS = [
  'poi-label',
  'poi-icon',
  'transit-label',
  'transit-stop-icon',
] as const

const SUPPRESSED_PRESS_WINDOW_MS = 250

export function useMapPressHandlers({
  mapViewRef,
  enabled,
  onRawMapPress,
  onMapPress,
  onMapInteraction,
  onLongPressTarget,
}: {
  mapViewRef: RefObject<ComponentRef<typeof Mapbox.MapView> | null>
  enabled: boolean
  onRawMapPress: (selection: MapSelection) => boolean | void
  onMapPress: (selection: MapSelection) => void
  onMapInteraction: () => void
  onLongPressTarget: (target: { latitude: number; longitude: number }) => void
}) {
  const suppressNextPressRef = useRef(false)
  const suppressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSuppressTimeout = useCallback(() => {
    if (!suppressTimeoutRef.current) return
    clearTimeout(suppressTimeoutRef.current)
    suppressTimeoutRef.current = null
  }, [])

  /** A pin handled the touch itself, so the map press that follows is not a new selection. */
  const suppressNextMapPress = useCallback(() => {
    clearSuppressTimeout()
    suppressNextPressRef.current = true
    suppressTimeoutRef.current = setTimeout(() => {
      suppressNextPressRef.current = false
      suppressTimeoutRef.current = null
    }, SUPPRESSED_PRESS_WINDOW_MS)
  }, [clearSuppressTimeout])

  const handleLongPress = useCallback(
    (feature: { geometry: { coordinates: number[] } }) => {
      if (!enabled) return
      const [longitude, latitude] = feature.geometry.coordinates
      if (onRawMapPress(coordinateSelection(longitude, latitude, 'long-press'))) return
      onMapInteraction()
      onLongPressTarget({ latitude, longitude })
    },
    [enabled, onLongPressTarget, onMapInteraction, onRawMapPress],
  )

  const handleMapPress = useCallback(
    (feature: GeoJSON.Feature<GeoJSON.Point, { screenPointX: number; screenPointY: number }>) => {
      if (suppressNextPressRef.current) {
        suppressNextPressRef.current = false
        clearSuppressTimeout()
        return
      }
      if (!enabled) return
      const [longitude, latitude] = feature.geometry?.coordinates ?? []
      if (typeof longitude !== 'number' || typeof latitude !== 'number') return
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return

      const fallbackSelection = coordinateSelection(longitude, latitude, 'coordinate')
      if (onRawMapPress(fallbackSelection)) return

      const screenPointX = feature.properties?.screenPointX
      const screenPointY = feature.properties?.screenPointY
      if (typeof screenPointX !== 'number' || typeof screenPointY !== 'number') {
        onMapPress(fallbackSelection)
        return
      }

      void mapViewRef.current
        ?.queryRenderedFeaturesAtPoint(
          [screenPointX, screenPointY],
          [],
          [...SELECTABLE_BASE_MAP_LAYER_IDS],
        )
        .then((features) => {
          onMapPress(
            placeSelectionFromFeatures(features?.features, { longitude, latitude }) ??
              fallbackSelection,
          )
        })
        .catch(() => {
          onMapPress(fallbackSelection)
        })
    },
    [clearSuppressTimeout, enabled, mapViewRef, onMapPress, onRawMapPress],
  )

  useEffect(() => clearSuppressTimeout, [clearSuppressTimeout])

  return { handleMapPress, handleLongPress, suppressNextMapPress }
}
