import type { MapRef, PressEvent } from '@maplibre/maplibre-react-native'
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { NativeSyntheticEvent } from 'react-native'

import {
  coordinateSelection,
  placeSelectionFromFeatures,
  type MapSelection,
} from '@/modules/map/lib/mapSelection'
import { reportUnexpectedError } from '@/config/sentry'

const SELECTABLE_BASE_MAP_LAYER_IDS = ['poi-label', 'transit-label']

const SUPPRESSED_PRESS_WINDOW_MS = 250

export function useMapPressHandlers({
  mapViewRef,
  enabled,
  onRawMapPress,
  onMapPress,
  onMapInteraction,
  onLongPressTarget,
}: {
  mapViewRef: RefObject<MapRef | null>
  enabled: boolean
  onRawMapPress: (selection: MapSelection) => boolean | undefined
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
    ({ nativeEvent }: NativeSyntheticEvent<PressEvent>) => {
      if (!enabled) return
      const [longitude, latitude] = nativeEvent.lngLat
      if (onRawMapPress(coordinateSelection(longitude, latitude, 'long-press'))) return
      onMapInteraction()
      onLongPressTarget({ latitude, longitude })
    },
    [enabled, onLongPressTarget, onMapInteraction, onRawMapPress],
  )

  const handleMapPress = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<PressEvent>) => {
      if (suppressNextPressRef.current) {
        suppressNextPressRef.current = false
        clearSuppressTimeout()
        return
      }
      if (!enabled) return
      const [longitude, latitude] = nativeEvent.lngLat
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return

      const fallbackSelection = coordinateSelection(longitude, latitude, 'coordinate')
      if (onRawMapPress(fallbackSelection)) return

      void mapViewRef.current
        ?.queryRenderedFeatures(nativeEvent.point, { layers: SELECTABLE_BASE_MAP_LAYER_IDS })
        .then((features) => {
          onMapPress(
            placeSelectionFromFeatures(features, { longitude, latitude }) ?? fallbackSelection,
          )
        })
        .catch((error: unknown) => {
          reportUnexpectedError(error, 'map_feature_query')
          onMapPress(fallbackSelection)
        })
    },
    [clearSuppressTimeout, enabled, mapViewRef, onMapPress, onRawMapPress],
  )

  useEffect(() => clearSuppressTimeout, [clearSuppressTimeout])

  return { handleMapPress, handleLongPress, suppressNextMapPress }
}
