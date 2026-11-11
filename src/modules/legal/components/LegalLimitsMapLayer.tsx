import { GeoJSONSource, Layer, type PressEventWithFeatures } from '@maplibre/maplibre-react-native'
import type { NativeSyntheticEvent } from 'react-native'

import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import legalCountryBoundaries from '@/modules/legal/constants/legalCountryBoundaries.json'
import {
  getLegalLimitCountryByCode,
  LEGAL_BOUNDARY_CODE_KEY,
  legalStatusColorExpression,
  type LegalLimitCountry,
} from '@/modules/legal/lib/legalLimits'
import { useLegalLimitLabelShape } from '@/modules/legal/hooks/useLegalLimitsFormat'

export function LegalLimitsMapLayer({
  interactive = true,
  fillBeforeId,
  onSelectCountry,
}: {
  interactive?: boolean
  /** First label layer of the loaded style; the fill goes below it so map labels stay on top. */
  fillBeforeId?: string
  onSelectCountry: (country: LegalLimitCountry) => void
}) {
  const labelShape = useLegalLimitLabelShape()
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const statusColors = {
    likelyLegal: accents.green.color,
    restricted: accents.amber.color,
    notRoadLegal: accents.red.color,
    unknown: accents.sky.color,
  }
  const selectByProperty =
    (key: string) => (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const code = event.nativeEvent.features
        .map((feature) => feature.properties?.[key])
        .find((value): value is string => typeof value === 'string')
      if (!code) return
      event.stopPropagation()
      const country = getLegalLimitCountryByCode(code)
      if (country) onSelectCountry(country)
    }

  return (
    <>
      <GeoJSONSource
        id="legal-country-boundaries"
        data={legalCountryBoundaries as GeoJSON.FeatureCollection}
        onPress={interactive ? selectByProperty(LEGAL_BOUNDARY_CODE_KEY) : undefined}
      >
        <Layer
          type="fill"
          id="legal-country-fill"
          beforeId={fillBeforeId}
          paint={{
            'fill-color': legalStatusColorExpression(statusColors) as never,
            'fill-opacity': 0.48,
            'fill-outline-color': theme.alpha(neutral.textPrimary, 0.7),
          }}
        />
        <Layer
          type="line"
          id="legal-country-outline"
          beforeId={fillBeforeId}
          paint={{
            'line-color': theme.alpha(neutral.textPrimary, 0.85),
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.75, 6, 1.6],
          }}
        />
      </GeoJSONSource>
      <GeoJSONSource
        id="legal-speed-labels"
        data={labelShape}
        onPress={interactive ? selectByProperty('code') : undefined}
      >
        <Layer
          type="symbol"
          id="legal-speed-label"
          layout={{
            'text-field': ['get', 'label'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 3, 18, 5, 28],
            'text-font': [...theme.map.fontBold],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          }}
          paint={{
            'text-color': theme.palette.mono.white,
            'text-halo-color': theme.palette.mono.black,
            'text-halo-width': 2,
          }}
        />
        <Layer
          type="symbol"
          id="legal-speed-unit-label"
          layout={{
            'text-field': ['get', 'subtitle'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 3, 8, 5, 11],
            'text-offset': [0, 1.65],
            'text-font': [...theme.map.fontRegular],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          }}
          paint={{
            'text-color': theme.alpha(theme.palette.mono.white, 0.8),
            'text-halo-color': theme.palette.mono.black,
            'text-halo-width': 1.5,
          }}
        />
      </GeoJSONSource>
    </>
  )
}
