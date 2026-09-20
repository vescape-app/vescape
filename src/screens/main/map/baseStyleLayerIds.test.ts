import { expect, test } from 'bun:test'

import { getOneDarkMapStyle } from '@/modules/map/constants/oneDarkMapStyle'
import { getSatelliteDarkMapStyle } from '@/modules/map/constants/satelliteDarkMapStyle'
import { baseStyleLayerIds } from '@/screens/main/map/baseStyleLayerIds'

test('only adopts layers present in each local style document', () => {
  const oneDark = baseStyleLayerIds(getOneDarkMapStyle(true, true, false))
  expect(oneDark.has('poi-label')).toBe(true)
  expect(oneDark.has('transit-label')).toBe(true)
  expect(oneDark.has('road-path')).toBe(true)

  const noPois = baseStyleLayerIds(getOneDarkMapStyle(false, false, false))
  expect(noPois.has('poi-label')).toBe(false)
  expect(noPois.has('transit-label')).toBe(false)

  const satelliteWithoutPois = baseStyleLayerIds(
    getSatelliteDarkMapStyle(false, false, false, true),
  )
  expect(satelliteWithoutPois.has('road-path')).toBe(true)
  expect(satelliteWithoutPois.has('transit-label')).toBe(false)
  expect(baseStyleLayerIds('{"layers":[{"id":"background"}]}').has('transit-label')).toBe(false)
})
