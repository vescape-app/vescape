import { expect, test } from 'bun:test'

import { getOneDarkMapStyle } from '@/modules/map/constants/oneDarkMapStyle'

function layers(showLabels = true, showIcons = true) {
  return JSON.parse(getOneDarkMapStyle(showLabels, showIcons, false)).layers as {
    id: string
    layout?: Record<string, unknown>
    paint?: Record<string, unknown>
  }[]
}

test('keeps each One Dark POI icon and label in one collision unit', () => {
  const styleLayers = layers()
  const poi = styleLayers.find((layer) => layer.id === 'poi-label')

  expect(styleLayers.some((layer) => layer.id === 'poi-icon')).toBe(false)
  expect(poi?.layout?.['icon-image']).toBeTruthy()
  expect(poi?.layout?.['text-field']).toBeTruthy()
  expect(poi?.layout?.['text-anchor']).toBe('top')
  expect(poi?.paint?.['icon-halo-width']).toBe(0)

  const transit = styleLayers.find((layer) => layer.id === 'transit-label')
  expect(JSON.stringify(transit?.layout?.['icon-image'])).not.toContain('network')
  expect(JSON.stringify(transit?.layout?.['icon-image'])).toContain('bus')
  expect(JSON.stringify(transit?.layout?.['icon-image'])).toContain('rail-light')
})

test('can still hide One Dark POI labels or icons independently', () => {
  const withoutLabels = JSON.parse(getOneDarkMapStyle(false, true, true)).layers.find(
    (layer: { id: string }) => layer.id === 'poi-label',
  ) as { layout?: Record<string, unknown> }
  const withoutIcons = layers(true, false).find((layer) => layer.id === 'poi-label')

  expect(withoutLabels?.layout?.['text-field']).toBe('')
  expect(withoutLabels?.layout?.['icon-image']).toBeTruthy()
  expect(withoutIcons?.layout?.['text-field']).toBeTruthy()
  expect(withoutIcons?.layout?.['icon-image']).toBe('')
})
