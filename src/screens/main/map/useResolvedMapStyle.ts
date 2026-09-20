import { useMemo } from 'react'

import { IS_MAPY_CONFIGURED } from '@/config/mapy'
import { BLANK_STYLE, MAP_STYLES, type MapStyleKey } from '@/modules/map/constants/mapStyles'
import {
  getSatelliteImageryPaint,
  getSatelliteOverlayMapStyle,
} from '@/modules/map/constants/satelliteDarkMapStyle'
import { getOneDarkMapStyle } from '@/modules/map/constants/oneDarkMapStyle'
import { resolveMapThemeTone } from '@/modules/map/lib/mapThemeTone'
import { useThemeStore } from '@/hooks/useTheme'
import { mapStyleForTheme } from '@/modules/map/lib/mapTheme'
import Mapbox from '@rnmapbox/maps'

import type { MainViewState } from '@/screens/main/mainViewState'
import { baseStyleLayerIds } from '@/screens/main/map/baseStyleLayerIds'

/**
 * Resolves the requested map style into everything the map view and the `existing`
 * layer overrides need: which style source to hand Mapbox, and how the current mode
 * tints it.
 */
export function useResolvedMapStyle({
  mapStyleKey,
  mode,
  satelliteOverlayEnabled,
  satelliteImageryOpacity,
  satelliteMapImageryOpacity,
  satelliteImagerySaturation,
  hideTelemetryMapDetails,
  loadedStyleSignature,
}: {
  mapStyleKey: MapStyleKey
  mode: MainViewState
  satelliteOverlayEnabled: boolean
  satelliteImageryOpacity: number
  satelliteMapImageryOpacity: number
  satelliteImagerySaturation: number
  hideTelemetryMapDetails: boolean
  loadedStyleSignature: string | null
}) {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const outdoorLight = useThemeStore((state) => state.outdoorLight)
  const renderedStyleKey = mapStyleForTheme(mapStyleKey, resolvedTheme)
  const requestedMapStyle =
    renderedStyleKey === 'outdoors'
      ? { key: 'outdoors' as const, styleURL: Mapbox.StyleURL.Outdoors }
      : (MAP_STYLES.find((style) => style.key === renderedStyleKey) ?? MAP_STYLES[0])
  const selectedMapStyle =
    requestedMapStyle.key === 'mapy' && !IS_MAPY_CONFIGURED ? MAP_STYLES[0] : requestedMapStyle
  const isMapy = selectedMapStyle.key === 'mapy'
  const isOneDark = selectedMapStyle.key === 'onedark'
  const isSatellite = selectedMapStyle.key === 'satellite'
  const isSatelliteOverlay = isSatellite && satelliteOverlayEnabled
  const useCustomJSON = isMapy || isOneDark || isSatelliteOverlay
  const mapDetailsVisible = mode === 'map' || (mode === 'telemetry' && !hideTelemetryMapDetails)

  const effectiveSatelliteImageryOpacity =
    mode === 'telemetry' ? satelliteImageryOpacity : satelliteMapImageryOpacity
  const effectiveSatelliteImagerySaturation = mode === 'telemetry' ? satelliteImagerySaturation : 0

  const satelliteTone = useMemo(
    () =>
      resolveMapThemeTone({
        theme: resolvedTheme,
        outdoorLight,
        imageryOpacity: effectiveSatelliteImageryOpacity,
        imagerySaturation: effectiveSatelliteImagerySaturation,
      }),
    [
      effectiveSatelliteImageryOpacity,
      effectiveSatelliteImagerySaturation,
      outdoorLight,
      resolvedTheme,
    ],
  )

  const satelliteImageryPaint = useMemo(
    () =>
      getSatelliteImageryPaint(
        satelliteTone.imageryOpacity,
        satelliteTone.imagerySaturation,
        satelliteTone.imageryContrast,
      ),
    [satelliteTone.imageryContrast, satelliteTone.imageryOpacity, satelliteTone.imagerySaturation],
  )
  const oneDarkStyleJSON = useMemo(() => getOneDarkMapStyle(true, true, false), [])
  const satelliteStyleJSON = useMemo(
    () => getSatelliteOverlayMapStyle(resolvedTheme),
    [resolvedTheme],
  )

  const styleJSON = isSatelliteOverlay
    ? satelliteStyleJSON
    : isOneDark
      ? oneDarkStyleJSON
      : isMapy
        ? BLANK_STYLE
        : undefined
  const existingLayerIds = useMemo(() => baseStyleLayerIds(styleJSON), [styleJSON])

  // Signed by the style document Mapbox actually receives. A theme change replaces the
  // satellite backdrop, so it must wait for the new document before adopting its layers.
  const styleSignature = styleJSON
    ? isMapy
      ? 'json:blank'
      : isSatelliteOverlay
        ? `json:satellite:${resolvedTheme}`
        : 'json:onedark'
    : String(selectedMapStyle.styleURL)
  const isStyleLoaded = loadedStyleSignature === styleSignature

  return useMemo(
    () => ({
      styleKey: selectedMapStyle.key,
      isMapy,
      isOneDark,
      isSatellite,
      isSatelliteOverlay,
      mapDetailsVisible,
      showBuildings3d: selectedMapStyle.key === 'outdoors' || selectedMapStyle.key === 'onedark',
      styleURL: useCustomJSON ? undefined : selectedMapStyle.styleURL,
      styleJSON,
      existingLayerIds,
      satelliteImageryPaint,
      satelliteRoadLineOpacity: satelliteTone.roadLineOpacity * (mode === 'telemetry' ? 0.6 : 1),
      styleSignature,
      isStyleLoaded,
      canUpdateExistingStyleLayers: isStyleLoaded && !isMapy,
    }),
    [
      isMapy,
      isOneDark,
      isSatellite,
      isSatelliteOverlay,
      isStyleLoaded,
      mapDetailsVisible,
      mode,
      satelliteImageryPaint,
      satelliteTone,
      selectedMapStyle,
      styleJSON,
      existingLayerIds,
      styleSignature,
      useCustomJSON,
    ],
  )
}
