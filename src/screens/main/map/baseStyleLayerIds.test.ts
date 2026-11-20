import { expect, test } from 'bun:test'

import {
  CUSTOM_DISTRICT_LABEL_LAYER_IDS,
  getOneDarkMapStyle,
} from '@/modules/map/constants/oneDarkMapStyle'
import {
  getSatelliteDarkMapStyle,
  getSatelliteOverlayMapStyle,
} from '@/modules/map/constants/satelliteDarkMapStyle'
import {
  baseStyleLayerIds,
  MAPBOX_V11_DISTRICT_LABEL_LAYER_IDS,
} from '@/screens/main/map/baseStyleLayerIds'

test('only adopts layers present in each local style document', () => {
  const oneDark = baseStyleLayerIds(getOneDarkMapStyle(true, true, true))
  expect(oneDark.has('poi-label')).toBe(true)
  expect(oneDark.has('transit-label')).toBe(true)
  expect(oneDark.has('road-path')).toBe(true)
  for (const id of CUSTOM_DISTRICT_LABEL_LAYER_IDS) {
    expect(oneDark.has(id)).toBe(true)
  }

  const satelliteOverlay = baseStyleLayerIds(getSatelliteOverlayMapStyle('dark'))
  for (const id of CUSTOM_DISTRICT_LABEL_LAYER_IDS) {
    expect(satelliteOverlay.has(id)).toBe(true)
  }

  const hostedStyle = baseStyleLayerIds(undefined)
  expect(hostedStyle.has('poi-label')).toBe(true)
  expect(hostedStyle.has('transit-label')).toBe(true)
  for (const id of MAPBOX_V11_DISTRICT_LABEL_LAYER_IDS) {
    expect(hostedStyle.has(id)).toBe(true)
  }

  const noPois = baseStyleLayerIds(getOneDarkMapStyle(false, false, false))
  expect(noPois.has('poi-label')).toBe(false)
  expect(noPois.has('transit-label')).toBe(false)
  for (const id of CUSTOM_DISTRICT_LABEL_LAYER_IDS) {
    expect(noPois.has(id)).toBe(false)
  }

  const satelliteWithoutPois = baseStyleLayerIds(
    getSatelliteDarkMapStyle(false, false, false, true),
  )
  expect(satelliteWithoutPois.has('road-path')).toBe(true)
  expect(satelliteWithoutPois.has('transit-label')).toBe(false)
  expect(baseStyleLayerIds('{"layers":[{"id":"background"}]}').has('transit-label')).toBe(false)
})
