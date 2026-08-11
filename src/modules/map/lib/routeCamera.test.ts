import { describe, expect, test } from 'bun:test'

import { getRouteFitCamera, ROUTE_CAMERA } from '@/modules/map/lib/routeCamera'

describe('history camera', () => {
  test('uses fixed history route padding', () => {
    const camera = getRouteFitCamera({
      route: [
        [19, 50],
        [19.1, 50.1],
      ],
      viewport: { width: 390, height: 844 },
      maxZoom: 19,
    })

    expect(camera?.padding).toEqual({
      paddingTop: ROUTE_CAMERA.routePaddingPx + 90,
      paddingRight: ROUTE_CAMERA.sidePaddingPx,
      paddingBottom: ROUTE_CAMERA.routePaddingPx + 180,
      paddingLeft: ROUTE_CAMERA.sidePaddingPx,
    })
  })

  test('keeps route padding stable when bottom interface height changes', () => {
    const base = getRouteFitCamera({
      route: [
        [19, 50],
        [19.1, 50.1],
      ],
      viewport: { width: 390, height: 844 },
      maxZoom: 19,
    })
    const withInset = getRouteFitCamera({
      route: [
        [19, 50],
        [19.1, 50.1],
      ],
      viewport: { width: 390, height: 844, bottomInset: 180 },
      maxZoom: 19,
    })

    expect(withInset?.padding).toEqual(base?.padding)
  })

  test('centers route independently from navigation mode camera offsets', () => {
    const camera = getRouteFitCamera({
      route: [
        [18, 49],
        [20, 51],
      ],
      viewport: { width: 800, height: 800 },
      maxZoom: 19,
    })

    expect(camera?.centerCoordinate[0]).toBe(19)
    expect(camera?.centerCoordinate[1]).toBeCloseTo(50.0104, 4)
  })

  test('chooses lower zoom for smaller viewport', () => {
    const route: [number, number][] = [
      [18, 49],
      [20, 51],
    ]
    const large = getRouteFitCamera({
      route,
      viewport: { width: 1000, height: 1000 },
      maxZoom: 19,
    })
    const small = getRouteFitCamera({
      route,
      viewport: { width: 390, height: 844 },
      maxZoom: 19,
    })

    expect(small?.zoomLevel).toBeLessThan(large?.zoomLevel ?? 0)
  })
})
