import { expect, test } from 'bun:test'

// Isolate native/UI mocks: Bun module mocks otherwise leak into unrelated store tests.
test('all orientations and free pan retain the same animated puck and phone-heading position source', () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      '--preload',
      './testSetup.ts',
      '--eval',
      `
      import { mock } from 'bun:test'
      import { strict as assert } from 'node:assert'
      import React from 'react'
      import { renderToStaticMarkup } from 'react-dom/server'
      import { reactNativeStub } from './testSetup.ts'
      globalThis.__DEV__ = true
      const sources = new Map()
      const layers = new Map()
      const layer = () => null
      mock.module('react-native', () => ({ ...reactNativeStub, processColor: (color) => color }))
      mock.module('@rnmapbox/maps', () => ({
        ShapeSource: (props) => { sources.set(props.id, props.shape); return props.children },
        CircleLayer: (props) => { layers.set(props.id, props.style); return null },
        FillLayer: (props) => { layers.set(props.id, props.style); return null },
        Images: layer, LineLayer: (props) => { layers.set(props.id, props.style); return null }, SymbolLayer: (props) => { layers.set(props.id, props.style); return null },
      }))
      mock.module('@rnmapbox/maps/src/assets/heading.png', () => ({ default: 'heading' }))
      mock.module('@/modules/map/constants/mapStyles', () => ({ MAP_DEFAULTS: { trailWidth: 3 } }))
      mock.module('@/modules/map/lib/deviceMotionPhoneHeadingAdapter', () => ({ deviceMotionPhoneHeadingAdapter: {} }))
      mock.module('@/modules/group-ride/components/RiderMapLayers', () => ({ RiderPresencePin: layer, RiderTrail: layer }))
      mock.module('@/modules/group-ride/lib/selectedBoardRailColor', () => ({ useSelectedBoardRailColor: () => null }))
      mock.module('@/modules/location/store/locationStore', () => ({
        useLocationStore: (select) => select({ latestRawLocation: { latitude: 51, longitude: 20, timestamp: 123 } }),
      }))
      const { theme } = await import('./src/constants/theme.ts')
      mock.module('@/hooks/useTheme', () => ({
        useResolvedNeutralColors: () => ({ surfaceDeep: theme.palette.mono.white }),
        useResolvedAccentColors: () => ({ violet: theme.palette.violet, purple: theme.palette.purple, amber: theme.palette.amber }),
      }))
      const { LiveMapLayers } = await import('./src/screens/main/map/LiveMapLayers.tsx')
      const { PhoneHeadingMapLayer } = await import('./src/modules/map/components/PhoneHeadingMapLayer.tsx')
      const animator = { __nativeTag: 42, moveTo: () => { throw Error('leaf layers must not drive position') } }
      const coordinate = { latitude: 52, longitude: 21 }
      const measuredTrail = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[16, 47], [17, 48], [18, 49], [19, 50]] }, properties: {} }
      const accuracyShape = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} }
      const noop = () => {}
      const displayRuntime = { active: true, smoothedTrail: [{ longitude: 18, latitude: 49 }, { longitude: 19, latitude: 50 }, { longitude: 20, latitude: 51 }], motion: { segment: () => ({ from: null, to: null, durationMs: 0, revision: 0 }), position: () => null, pointHeading: () => null }, now: () => 0, duration: ms => ms, subscribe: () => noop }
      for (const mode of ['northUp', 'gpsHeading', 'phoneHeading', 'freeRotate']) {
        for (const follow of [false, true]) {
          for (const highContrastRoutes of [false, true]) {
          sources.clear()
          layers.clear()
          renderToStaticMarkup(React.createElement(React.Fragment, null,
            React.createElement(PhoneHeadingMapLayer, {
              active: mode !== 'gpsHeading', followCamera: mode === 'phoneHeading' && follow,
              coordinate, pointAnimator: animator, onFollowHeading: noop, onHeadingChange: noop, onStatusChange: noop,
            }),
            React.createElement(LiveMapLayers, {
              accuracyFix: coordinate, pointAnimator: animator, displayRuntime, accuracyShape,
              liveTrailShape: measuredTrail, gpsPuckBearingDeg: mode === 'gpsHeading' ? 90 : null,
              riders: [], highContrastRoutes,
            }),
          ))
          assert.deepEqual(sources.get('center-live-trail-source').geometry.coordinates, [[16, 47], [17, 48], [18, 49], [19, 50]])
          assert.deepEqual(sources.get('center-smoothed-trail-source').geometry.coordinates, [[18, 49], [19, 50], [20, 51]])
          assert.equal(measuredTrail.geometry.coordinates.length, 4)
          assert.equal(layers.get('center-smoothed-trail-line').lineColor, theme.palette.mono.white)
          assert.equal(sources.get('center-gps-accuracy-source'), accuracyShape, mode + ': preserve accuracy polygon')
          assert.ok(layers.has('center-gps-accuracy-fill'), mode + ': preserve FillLayer')
          assert.ok(!layers.has('center-gps-moving-accuracy'), mode + ': no replacement circle')
          assert.equal(layers.get('center-gps-puck-core').circleRadius, 8)
          assert.equal(layers.get('center-gps-puck-core').circleStrokeWidth, 3)
          assert.equal(sources.get('center-gps-puck-position-source'), animator, mode + ': puck')
          assert.equal(sources.get('center-phone-heading-source'), animator, mode + ': compass glyph')
          assert.equal(
            layers.get('center-phone-heading-outline').iconRotationAlignment,
            mode === 'phoneHeading' && follow ? 'viewport' : 'map',
          )
          if (mode === 'gpsHeading') assert.equal(sources.get('center-gps-puck-heading-source'), animator)
        }
        }
      }
    `,
    ],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect({ exitCode: result.exitCode, stderr: new TextDecoder().decode(result.stderr) }).toEqual({
    exitCode: 0,
    stderr: '',
  })
})
