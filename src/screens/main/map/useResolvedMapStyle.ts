import type { StyleSpecification } from '@maplibre/maplibre-react-native'
import { useMemo } from 'react'

import { useThemeStore } from '@/hooks/useTheme'
import { MAP_DEFAULTS, MAP_STYLES, type MapStyleKey } from '@/modules/map/constants/mapStyles'
import {
  buildOneDarkStyle,
  buildRasterStyle,
  buildSatelliteStyle,
  firstLabelLayerId,
  LIGHT_STYLE_URL,
  styleLayerUpdates,
} from '@/modules/map/constants/oneDarkOpenMapTilesStyle'
import {
  getSatelliteImageryPaint,
  getSatelliteOverlayColors,
} from '@/modules/map/constants/satelliteDarkMapStyle'
import { mapStyleForTheme } from '@/modules/map/lib/mapTheme'
import { resolveMapThemeTone } from '@/modules/map/lib/mapThemeTone'
import { useMapServicesStore } from '@/modules/map/store/mapServicesStore'
import type { MainViewState } from '@/screens/main/mainViewState'

/** Tone values move with outdoor light; stepped so a small drift does not restyle the map. */
const quantize = (value: number) => Math.round(value * 20) / 20

/**
 * Resolves the requested map style into the style document the map loads, plus the in-place
 * updates for what changes with the mode and outdoor light (POI and transit visibility, satellite
 * dimming, road line opacity). Only a different base map changes the document and reloads it.
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

  // The document's identity. Runtime values are left out: they reach the loaded style as
  // `layerUpdates`, and the document is only rebuilt for a different base map.
  const styleSignature =
    styleKey === 'satellite'
      ? `satellite:${resolvedTheme}`
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
    // Built for a new signature only; later runtime values arrive as `layerUpdates`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleSignature])

  const layerUpdates = useMemo(
    () =>
      styleLayerUpdates({
        styleKey,
        detailsVisible: mapDetailsVisible,
        imagery: {
          opacity: imageryOpacity,
          saturation: imagerySaturation,
          contrast: imageryContrast,
        },
        roadLineOpacity,
      }),
    [
      imageryContrast,
      imageryOpacity,
      imagerySaturation,
      mapDetailsVisible,
      roadLineOpacity,
      styleKey,
    ],
  )

  return useMemo(
    () => ({
      styleKey,
      isSatellite,
      mapDetailsVisible,
      mapStyle,
      styleSignature,
      layerUpdates,
      fillBeforeId: firstLabelLayerId(styleKey),
    }),
    [isSatellite, layerUpdates, mapDetailsVisible, mapStyle, styleKey, styleSignature],
  )
}
