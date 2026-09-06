import { describe, expect, test } from 'bun:test'

import { buildMapyTileUrlTemplate, getMapyApiKey } from '@/modules/map/lib/mapyTiles'

describe('Mapy.com tile URL config', () => {
  test('treats missing and blank API keys as unconfigured', () => {
    expect(getMapyApiKey(undefined)).toBeNull()
    expect(getMapyApiKey(null)).toBeNull()
    expect(getMapyApiKey('   ')).toBeNull()
  })

  test('does not build unauthenticated tile templates', () => {
    expect(buildMapyTileUrlTemplate('')).toBeNull()
    expect(buildMapyTileUrlTemplate('   ')).toBeNull()
  })

  test('builds current Mapy.com outdoor retina tile template with encoded API key', () => {
    expect(buildMapyTileUrlTemplate(' key with spaces ')).toBe(
      'https://api.mapy.com/v1/maptiles/outdoor/256@2x/{z}/{x}/{y}?lang=en&apikey=key+with+spaces',
    )
  })
})
