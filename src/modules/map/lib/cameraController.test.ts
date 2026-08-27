import { describe, expect, test } from 'bun:test'

import {
  initialMapCameraControllerState,
  reduceMapCameraIntent,
} from '@/modules/map/lib/cameraController'

describe('map camera controller', () => {
  const gpsCamera = {
    centerCoordinate: [19, 50] as [number, number],
    zoomLevel: 13,
  }

  test('preserves state identity when manual browsing is already active', () => {
    const browsing = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'BrowseManually',
    }).state

    const repeated = reduceMapCameraIntent(browsing, { type: 'BrowseManually' })

    expect(repeated.state).toBe(browsing)
    expect(repeated.effect).toBeNull()
  })

  describe('preview pan ownership', () => {
    const anchorCamera = {
      centerCoordinate: [19, 50] as [number, number],
      zoomLevel: 15,
      heading: 30,
      pitch: 20,
    }
    const liveCamera = {
      centerCoordinate: [19.1, 50.1] as [number, number],
      zoomLevel: 16,
      heading: 90,
      pitch: 52,
    }

    test('a cancelled drag rides back to the mode it interrupted', () => {
      const panning = reduceMapCameraIntent(initialMapCameraControllerState, {
        type: 'BeginPreviewPan',
      }).state

      const cancelled = reduceMapCameraIntent(panning, {
        type: 'CancelPreviewPan',
        liveCamera,
        anchorCamera,
      })

      expect(cancelled.state.mode).toEqual({ kind: 'liveFollow' })
      expect(cancelled.effect?.camera).toEqual(liveCamera)
    })

    test('a cancelled drag without a fix stays on its own anchor', () => {
      const panning = reduceMapCameraIntent(initialMapCameraControllerState, {
        type: 'BeginPreviewPan',
      }).state

      const cancelled = reduceMapCameraIntent(panning, {
        type: 'CancelPreviewPan',
        liveCamera: null,
        anchorCamera,
      })

      expect(cancelled.effect?.camera).toEqual(anchorCamera)
    })

    test('an intent issued mid-drag takes the camera and the cancel does nothing', () => {
      const panning = reduceMapCameraIntent(initialMapCameraControllerState, {
        type: 'BeginPreviewPan',
      }).state
      const weather = reduceMapCameraIntent(panning, {
        type: 'EnterWeatherView',
        currentCamera: null,
        fallbackCenterCoordinate: [19, 50],
        perspectiveEnabled: true,
      })

      const cancelled = reduceMapCameraIntent(weather.state, {
        type: 'CancelPreviewPan',
        liveCamera,
        anchorCamera,
      })

      expect(weather.effect?.camera.zoomLevel).toBe(8)
      expect(cancelled.state).toBe(weather.state)
      expect(cancelled.effect).toBeNull()
    })

    test('manual browsing does not take the camera from a drag in progress', () => {
      const panning = reduceMapCameraIntent(initialMapCameraControllerState, {
        type: 'BeginPreviewPan',
      }).state

      const browsing = reduceMapCameraIntent(panning, { type: 'BrowseManually' })

      expect(browsing.state).toBe(panning)
    })

    test('a drag that ends on the map keeps the dragged viewport', () => {
      const panning = reduceMapCameraIntent(initialMapCameraControllerState, {
        type: 'BeginPreviewPan',
      }).state

      const ended = reduceMapCameraIntent(panning, { type: 'EndPreviewPan' })

      expect(ended.state.mode).toEqual({ kind: 'manualBrowse' })
      expect(ended.effect).toBeNull()
    })

    test('ending a drag that no longer owns the camera changes nothing', () => {
      const weather = reduceMapCameraIntent(initialMapCameraControllerState, {
        type: 'EnterWeatherView',
        currentCamera: null,
        fallbackCenterCoordinate: [19, 50],
        perspectiveEnabled: true,
      }).state

      const ended = reduceMapCameraIntent(weather, { type: 'EndPreviewPan' })

      expect(ended.state).toBe(weather)
      expect(ended.effect).toBeNull()
    })
  })

  test('routes live follow through the GPS heading profile', () => {
    const result = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'FollowLive',
      gpsCamera,
      followHeadingDeg: 91,
      orientationMode: 'gpsHeading',
      perspectiveEnabled: true,
      viewportHeight: 1000,
    })

    expect(result.state.mode).toEqual({ kind: 'liveFollow' })
    expect(result.effect?.camera).toMatchObject({
      centerCoordinate: [19, 50],
      zoomLevel: 16,
      heading: 91,
      pitch: 56,
      padding: {
        paddingTop: 200,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
      },
    })
  })

  test('preserves heading for free rotate live follow', () => {
    const result = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'FollowLive',
      gpsCamera,
      followHeadingDeg: 0,
      orientationMode: 'freeRotate',
      perspectiveEnabled: true,
      preserveHeading: 42,
    })

    expect(result.effect?.camera.heading).toBe(42)
  })

  test('manual browse exits live follow without producing a camera write', () => {
    const result = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'BrowseManually',
    })

    expect(result.state.mode).toEqual({ kind: 'manualBrowse' })
    expect(result.effect).toBeNull()
  })

  test('perspective change recomputes pitch from the active profile', () => {
    const result = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'ChangePerspective',
      enabled: true,
      currentCamera: {
        centerCoordinate: [19, 50],
        zoomLevel: 16,
        heading: 0,
        pitch: 0,
      },
      fallbackZoomLevel: 13,
      orientationMode: 'gpsHeading',
    })

    expect(result.effect?.camera).toEqual({ pitch: 56 })
  })

  test('refines ride history preview to route for the same selection', () => {
    const preview = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'FrameRideHistoryPreview',
      selectionKey: 'ride-1',
      camera: {
        centerCoordinate: [19, 50],
        zoomLevel: 11,
        heading: 0,
        pitch: 0,
      },
    })
    const route = reduceMapCameraIntent(preview.state, {
      type: 'RefineRideHistoryRoute',
      selectionKey: 'ride-1',
      camera: {
        centerCoordinate: [19.1, 50.1],
        zoomLevel: 12,
        heading: 0,
        pitch: 0,
      },
    })

    expect(route.state.mode).toEqual({
      kind: 'rideHistory',
      selectionKey: 'ride-1',
      phase: 'route',
    })
    expect(route.effect?.camera.centerCoordinate).toEqual([19.1, 50.1])
  })

  test('ignores stale ride history route refinement', () => {
    const preview = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'FrameRideHistoryPreview',
      selectionKey: 'ride-1',
      camera: {
        centerCoordinate: [19, 50],
        zoomLevel: 11,
        heading: 0,
        pitch: 0,
      },
    })
    const route = reduceMapCameraIntent(preview.state, {
      type: 'RefineRideHistoryRoute',
      selectionKey: 'ride-2',
      camera: {
        centerCoordinate: [20, 51],
        zoomLevel: 12,
        heading: 0,
        pitch: 0,
      },
    })

    expect(route.state).toEqual(preview.state)
    expect(route.effect).toBeNull()
  })

  test('manual ride history browse cancels automatic route refinement', () => {
    const preview = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'FrameRideHistoryPreview',
      selectionKey: 'ride-1',
      camera: {
        centerCoordinate: [19, 50],
        zoomLevel: 11,
        heading: 0,
        pitch: 0,
      },
    })
    const manual = reduceMapCameraIntent(preview.state, {
      type: 'BrowseManually',
      historySelectionKey: 'ride-1',
    })
    const route = reduceMapCameraIntent(manual.state, {
      type: 'RefineRideHistoryRoute',
      selectionKey: 'ride-1',
      camera: {
        centerCoordinate: [19.1, 50.1],
        zoomLevel: 12,
        heading: 0,
        pitch: 0,
      },
    })

    expect(route.state.mode).toEqual({
      kind: 'rideHistory',
      selectionKey: 'ride-1',
      phase: 'manualInspect',
    })
    expect(route.effect).toBeNull()
  })

  test('weather view centers on current GPS fallback and uses flat weather profile', () => {
    const result = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'EnterWeatherView',
      currentCamera: {
        centerCoordinate: [19, 50],
        zoomLevel: 14,
        heading: 37,
        pitch: 45,
      },
      fallbackCenterCoordinate: [15, 54],
      perspectiveEnabled: true,
    })

    expect(result.effect?.camera).toEqual({
      centerCoordinate: [15, 54],
      zoomLevel: 8,
      heading: 0,
      pitch: 0,
    })
  })

  test('legal limits view uses the supplied flat overview camera', () => {
    const camera = {
      centerCoordinate: [13, 53] as [number, number],
      zoomLevel: 3.05,
      heading: 0,
      pitch: 0,
    }
    const result = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'EnterLegalLimitsView',
      camera,
    })

    expect(result.state.mode).toEqual({ kind: 'manualBrowse' })
    expect(result.effect?.camera).toBe(camera)
  })

  test('map point focus recomputes pitch from profile and zoom', () => {
    const result = reduceMapCameraIntent(initialMapCameraControllerState, {
      type: 'FocusCoordinate',
      coordinate: [20, 51],
      currentCamera: {
        centerCoordinate: [19, 50],
        zoomLevel: 16,
        heading: 33,
        pitch: 3,
      },
      fallbackZoomLevel: 13,
      orientationMode: 'northUp',
      perspectiveEnabled: true,
    })

    expect(result.state.mode).toEqual({ kind: 'manualBrowse' })
    expect(result.effect?.camera).toEqual({
      centerCoordinate: [20, 51],
      zoomLevel: 16,
      heading: 0,
      pitch: 45,
    })
  })
})
