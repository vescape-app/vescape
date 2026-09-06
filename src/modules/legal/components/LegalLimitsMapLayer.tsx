import { FillLayer, LineLayer, ShapeSource, SymbolLayer, VectorSource } from '@rnmapbox/maps'

import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  getLegalLimitCountryByCode,
  legalCountryFilterExpression,
  legalLimitLabelShape,
  legalStatusColorExpression,
  type LegalLimitCountry,
} from '@/modules/legal/lib/legalLimits'

const LEGAL_LIMIT_LABEL_SHAPE = legalLimitLabelShape()

export function LegalLimitsMapLayer({
  interactive = true,
  onSelectCountry,
}: {
  interactive?: boolean
  onSelectCountry: (country: LegalLimitCountry) => void
}) {
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const statusColors = {
    likelyLegal: accents.green.color,
    restricted: accents.amber.color,
    notRoadLegal: accents.red.color,
    unknown: accents.sky.color,
  }
  const handlePress = (event: { features: GeoJSON.Feature[] }) => {
    const alpha3 = event.features
      .map((feature) => feature.properties?.iso_3166_1_alpha_3)
      .find((value): value is string => typeof value === 'string')
    if (!alpha3) return
    const country = getLegalLimitCountryByCode(alpha3)
    if (country) onSelectCountry(country)
  }
  const handleLabelPress = (event: { features: GeoJSON.Feature[] }) => {
    const code = event.features
      .map((feature) => feature.properties?.code)
      .find((value): value is string => typeof value === 'string')
    if (!code) return
    const country = getLegalLimitCountryByCode(code)
    if (country) onSelectCountry(country)
  }

  return (
    <>
      <VectorSource
        id="legal-country-boundaries"
        url="mapbox://mapbox.country-boundaries-v1"
        hitbox={{ width: 44, height: 44 }}
        onPress={interactive ? handlePress : undefined}
      >
        <FillLayer
          id="legal-country-fill"
          sourceLayerID="country_boundaries"
          filter={legalCountryFilterExpression() as never}
          style={{
            fillColor: legalStatusColorExpression(statusColors) as never,
            fillOpacity: 0.48,
            fillOutlineColor: theme.alpha(neutral.textPrimary, 0.7),
          }}
        />
        <LineLayer
          id="legal-country-outline"
          sourceLayerID="country_boundaries"
          filter={legalCountryFilterExpression() as never}
          style={{
            lineColor: theme.alpha(neutral.textPrimary, 0.85),
            lineWidth: ['interpolate', ['linear'], ['zoom'], 3, 0.75, 6, 1.6],
          }}
        />
      </VectorSource>
      <ShapeSource
        id="legal-speed-labels"
        shape={LEGAL_LIMIT_LABEL_SHAPE}
        hitbox={{ width: 44, height: 44 }}
        onPress={interactive ? handleLabelPress : undefined}
      >
        <SymbolLayer
          id="legal-speed-label"
          style={{
            textField: ['get', 'label'],
            textSize: ['interpolate', ['linear'], ['zoom'], 3, 18, 5, 28],
            textColor: theme.palette.mono.white,
            textHaloColor: theme.palette.mono.black,
            textHaloWidth: 2,
            textFont: ['Open Sans Bold', 'Arial Unicode MS Bold'],
            textAllowOverlap: true,
            textIgnorePlacement: true,
          }}
        />
        <SymbolLayer
          id="legal-speed-unit-label"
          style={{
            textField: ['get', 'subtitle'],
            textSize: ['interpolate', ['linear'], ['zoom'], 3, 8, 5, 11],
            textColor: theme.alpha(theme.palette.mono.white, 0.8),
            textHaloColor: theme.palette.mono.black,
            textHaloWidth: 1.5,
            textOffset: [0, 1.65],
            textFont: ['Open Sans Semibold', 'Arial Unicode MS Regular'],
            textAllowOverlap: true,
            textIgnorePlacement: true,
          }}
        />
      </ShapeSource>
    </>
  )
}
