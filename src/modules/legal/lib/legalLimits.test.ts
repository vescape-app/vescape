import { describe, expect, test } from 'bun:test'

import {
  LEGAL_LIMIT_COUNTRIES,
  getLegalLimitCountryDetail,
  legalLimitLabelShape,
  legalReferenceSpeedLabel,
} from '@/modules/legal/lib/legalLimits'

describe('Legal Policy display units', () => {
  test('shows a single converted legal reference and keeps N/A unitless', () => {
    expect(legalReferenceSpeedLabel(25, 'metric')).toBe('25 km/h')
    expect(legalReferenceSpeedLabel(25, 'imperial')).toBe('15.5 mph')
    expect(legalReferenceSpeedLabel(null, 'metric')).toBe('N/A')
    expect(legalReferenceSpeedLabel(null, 'imperial')).toBe('N/A')
  })

  test('rebuilds map labels for the preference without changing geometry or policy data', () => {
    const catalog = JSON.stringify(LEGAL_LIMIT_COUNTRIES)
    const descriptions = LEGAL_LIMIT_COUNTRIES.map(getLegalLimitCountryDetail)
    const metric = legalLimitLabelShape('metric')
    const imperial = legalLimitLabelShape('imperial')
    const belgium = (shape: typeof metric) =>
      shape.features.find((f) => f.properties?.code === 'BE')!
    const czechia = (shape: typeof metric) =>
      shape.features.find((f) => f.properties?.code === 'CZ')!
    expect(imperial).not.toBe(metric)
    expect(belgium(metric).properties).toMatchObject({ label: '25', subtitle: 'km/h' })
    expect(belgium(imperial).properties).toMatchObject({ label: '15.5', subtitle: 'mph' })
    expect(czechia(imperial).properties).toMatchObject({ label: 'N/A', subtitle: '' })
    expect(imperial.features.map((f) => f.geometry)).toEqual(metric.features.map((f) => f.geometry))
    expect(legalLimitLabelShape('metric')).toEqual(metric)
    expect(JSON.stringify(LEGAL_LIMIT_COUNTRIES)).toBe(catalog)
    expect(LEGAL_LIMIT_COUNTRIES.map(getLegalLimitCountryDetail)).toEqual(descriptions)
  })
})
