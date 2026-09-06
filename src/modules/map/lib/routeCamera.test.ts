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
      paddingBottom: ROUTE_CAMERA.routePaddingPx + ROUTE_CAMERA.defaultBottomInsetPx,
      paddingLeft: ROUTE_CAMERA.sidePaddingPx,
    })
  })

  test('fits the route above the bottom interface, and reframes when it grows', () => {
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
      viewport: { width: 390, height: 844, bottomInset: 320 },
      maxZoom: 19,
    })

    expect(withInset?.padding.paddingBottom).toBe(ROUTE_CAMERA.routePaddingPx + 320)
    expect(withInset?.padding.paddingBottom).toBeGreaterThan(base!.padding.paddingBottom)
    // Less room means the route has to be drawn smaller to still fit inside it.
    expect(withInset!.zoomLevel).toBeLessThan(base!.zoomLevel)
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
