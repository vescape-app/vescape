import type { StyleSpecification } from '@maplibre/maplibre-react-native'
import { useMemo } from 'react'

import { useThemeStore } from '@/hooks/useTheme'
import { MAP_DEFAULTS, MAP_STYLES, type MapStyleKey } from '@/modules/map/constants/mapStyles'
import {
  buildOneDarkStyle,
  buildRasterStyle,
  buildSatelliteStyle,
} from '@/modules/map/constants/oneDarkOpenMapTilesStyle'
import {
  getSatelliteImageryPaint,
  getSatelliteOverlayColors,
} from '@/modules/map/constants/satelliteDarkMapStyle'
import { mapStyleForTheme } from '@/modules/map/lib/mapTheme'
import { resolveMapThemeTone } from '@/modules/map/lib/mapThemeTone'
import { useMapServicesStore } from '@/modules/map/store/mapServicesStore'
import type { MainViewState } from '@/screens/main/mainViewState'

/** OpenFreeMap's light style stands in for Mapbox Outdoors in the light theme. */
const LIGHT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/**
 * Tone values move with outdoor light. Each distinct value is a new style document (a native style
 * reload), so they are stepped before they reach the document.
 */
const quantize = (value: number) => Math.round(value * 20) / 20

/**
 * Resolves the requested map style into the style document the map loads. MapLibre cannot restyle a
 * loaded base-style layer from JSX, so mode-dependent details (POI and transit visibility,
 * satellite dimming, road line opacity) are baked into the document; a change reloads the style.
 */
export function useResolvedMapStyle({
  mapStyleKey,
  mode,
  satelliteOverlayEnabled,
  satelliteImageryOpacity,
  satelliteMapImageryOpacity,
  satelliteImagerySaturation,
  hideTelemetryMapDetails,
}: {
  mapStyleKey: MapStyleKey
  mode: MainViewState
  satelliteOverlayEnabled: boolean
  satelliteImageryOpacity: number
  satelliteMapImageryOpacity: number
  satelliteImagerySaturation: number
  hideTelemetryMapDetails: boolean
}) {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const mapyTileUrlTemplate = useMapServicesStore((state) => state.mapyTileUrlTemplate)
  const mapboxToken = useMapServicesStore((state) => state.mapboxToken)
  const outdoorLight = useThemeStore((state) => state.outdoorLight)
  const renderedStyleKey = mapStyleForTheme(mapStyleKey, resolvedTheme)
  // Satellite tiles need the Mapbox token, Mapy tiles their own URL; without one, Streets.
  const styleKey: MapStyleKey =
    (renderedStyleKey === 'mapy' && !mapyTileUrlTemplate) ||
    (renderedStyleKey === 'satellite' && !mapboxToken) ||
    !(renderedStyleKey === 'outdoors' || MAP_STYLES.some((style) => style.key === renderedStyleKey))
      ? MAP_STYLES[0].key
      : renderedStyleKey
  const isSatellite = styleKey === 'satellite'
  const mapDetailsVisible = mode === 'map' || (mode === 'telemetry' && !hideTelemetryMapDetails)

  const tone = resolveMapThemeTone({
    theme: resolvedTheme,
    outdoorLight,
    imageryOpacity: mode === 'telemetry' ? satelliteImageryOpacity : satelliteMapImageryOpacity,
    imagerySaturation: mode === 'telemetry' ? satelliteImagerySaturation : 0,
  })
  const imagery = satelliteOverlayEnabled
    ? getSatelliteImageryPaint(tone.imageryOpacity, tone.imagerySaturation, tone.imageryContrast)
    : getSatelliteImageryPaint(1, 0, 0)
  const imageryOpacity = quantize(imagery.rasterOpacity)
  const imagerySaturation = quantize(imagery.rasterSaturation)
  const imageryContrast = quantize(imagery.rasterContrast)
  const roadLineOpacity = quantize(tone.roadLineOpacity * (mode === 'telemetry' ? 0.6 : 1))

  const styleSignature =
    styleKey === 'satellite'
      ? `satellite:${resolvedTheme}:${mapDetailsVisible}:${imageryOpacity}:${imagerySaturation}:${imageryContrast}:${roadLineOpacity}`
      : styleKey === 'onedark'
        ? `onedark:${mapDetailsVisible}`
        : styleKey === 'mapy'
          ? `mapy:${mapyTileUrlTemplate}`
          : styleKey

  const mapStyle = useMemo((): string | StyleSpecification => {
    switch (styleKey) {
      case 'outdoors':
        return LIGHT_STYLE_URL
      case 'mapy':
        return buildRasterStyle({
          tileUrl: mapyTileUrlTemplate ?? '',
          maxzoom: MAP_DEFAULTS.maxZoom,
        }) as StyleSpecification
      case 'satellite':
        return buildSatelliteStyle({
          detailsVisible: mapDetailsVisible,
          tileUrl: `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=${mapboxToken}`,
          imagery: {
            opacity: imageryOpacity,
            saturation: imagerySaturation,
            contrast: imageryContrast,
          },
          roadLineOpacity,
          ...getSatelliteOverlayColors(resolvedTheme),
        }) as StyleSpecification
      case 'onedark':
        return buildOneDarkStyle({ detailsVisible: mapDetailsVisible }) as StyleSpecification
    }
    // The signature carries every input; the document is rebuilt only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleSignature])

  return useMemo(
    () => ({
      styleKey,
      isMapy: styleKey === 'mapy',
      isOneDark: styleKey === 'onedark',
      isSatellite,
      mapDetailsVisible,
      mapStyle,
      styleSignature,
    }),
    [isSatellite, mapDetailsVisible, mapStyle, styleKey, styleSignature],
  )
}
