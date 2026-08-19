import { useMemo } from 'react'

import { IS_MAPY_CONFIGURED } from '@/config/mapy'
import { BLANK_STYLE, MAP_STYLES, type MapStyleKey } from '@/modules/map/constants/mapStyles'
import { getSatelliteImageryPaint } from '@/modules/map/constants/satelliteDarkMapStyle'
import { getOneDarkMapStyle } from '@/modules/map/constants/oneDarkMapStyle'
import { resolveMapThemeTone } from '@/modules/map/lib/mapThemeTone'
import { useThemeStore } from '@/hooks/useTheme'

import type { MainViewState } from '@/screens/main/mainViewState'

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
  const requestedMapStyle = MAP_STYLES.find((style) => style.key === mapStyleKey) ?? MAP_STYLES[0]
  const selectedMapStyle =
    requestedMapStyle.key === 'mapy' && !IS_MAPY_CONFIGURED ? MAP_STYLES[0] : requestedMapStyle
  const isMapy = selectedMapStyle.key === 'mapy'
  const isOneDark = selectedMapStyle.key === 'onedark'
  const isSatellite = selectedMapStyle.key === 'satellite'
  const isSatelliteOverlay = isSatellite && satelliteOverlayEnabled
  const useCustomJSON = isMapy || isOneDark
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

  const styleSignature = `${selectedMapStyle.key}:${useCustomJSON ? 'json' : selectedMapStyle.styleURL}`

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
      styleJSON: isOneDark ? oneDarkStyleJSON : isMapy ? BLANK_STYLE : undefined,
      satelliteImageryPaint,
      satelliteRoadLineOpacity: satelliteTone.roadLineOpacity * (mode === 'telemetry' ? 0.6 : 1),
      styleSignature,
      canUpdateExistingStyleLayers: loadedStyleSignature === styleSignature && !isMapy,
    }),
    [
      isMapy,
      isOneDark,
      isSatellite,
      isSatelliteOverlay,
      loadedStyleSignature,
      mapDetailsVisible,
      mode,
      oneDarkStyleJSON,
      satelliteImageryPaint,
      satelliteTone,
      selectedMapStyle,
      styleSignature,
      useCustomJSON,
    ],
  )
}
