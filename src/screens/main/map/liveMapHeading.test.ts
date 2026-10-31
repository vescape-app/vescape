import { expect, test } from 'bun:test'

// Isolate native renderer stubs: Bun's module mocks otherwise leak into unrelated test files.
test('live renderer removes the GPS arrow outside GPS-heading mode even with a retained bearing', () => {
  const result = Bun.spawnSync(
    [
      'bun',
      '-e',
      `
import { mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
mock.module('react-native', () => ({ processColor: (color) => color }))
const layer = ({ id, aboveLayerID, belowLayerID, style, children }) => createElement('map-layer', { 'data-id': id, 'data-above': aboveLayerID, 'data-below': belowLayerID, 'data-opacity': style?.circleOpacity }, children)
mock.module('@rnmapbox/maps', () => ({
  CircleLayer: layer, FillLayer: layer, Images: () => null,
  LineLayer: layer, ShapeSource: layer, SymbolLayer: layer,
}))
mock.module('@rnmapbox/maps/src/assets/heading.png', () => ({ default: 'heading' }))
mock.module('@/constants/theme', () => ({ theme: {
  alpha: (color) => color, palette: { mono: { white: 'white' } },
}}))
mock.module('@/hooks/useTheme', () => ({
  useResolvedNeutralColors: () => ({ surfaceDeep: 'black' }),
  useResolvedAccentColors: () => ({ purple: { color: 'purple' }, violet: { color: 'violet' } }),
}))
mock.module('@/modules/group-ride/lib/selectedBoardRailColor', () => ({ useSelectedBoardRailColor: () => null }))
mock.module('@/modules/group-ride/components/RiderMapLayers', () => ({ RiderPresencePin: () => null, RiderTrail: () => null }))
mock.module('@/modules/map/constants/mapStyles', () => ({ MAP_DEFAULTS: { trailWidth: 2, userPositionLayerId: 'center-gps-puck-core' } }))
mock.module('@/modules/map/store/liveMotionSettings', () => ({ useLiveMotionSettings: {} }))
const { LiveMapLayers } = await import('./src/screens/main/map/LiveMapLayers')
const props = {
  pointAnimator: {}, displayRuntime: { active: true, motion: {}, now: () => 1000 },
  accuracyFix: { longitude: 0, latitude: 0 }, accuracyShape: null,
  liveTrailShape: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0,0],[1,1]] } }, gpsPuckBearingDeg: 90, riders: [], highContrastRoutes: false,
}
const counts = []
// Retained heading while switching GPS -> compass -> north -> free -> GPS.
for (const gpsHeadingMode of [true, false, false, false, true]) {
  const html = renderToStaticMarkup(createElement(LiveMapLayers, { ...props, gpsHeadingMode }))
  if (!html.includes('data-id="center-live-trail-line" data-below="center-gps-puck-core"')) throw new Error('Trail is not explicitly below the rider')
  if (gpsHeadingMode && !html.includes('data-id="center-gps-puck-heading-outline" data-above="center-gps-puck-core"')) throw new Error('Heading is not above the rider anchor')
  counts.push({
    arrow: (html.match(/data-id="center-gps-puck-heading-outline"/g) ?? []).length,
    dot: (html.match(/data-id="center-gps-puck-core"/g) ?? []).length,
  })
}
const withoutFix = renderToStaticMarkup(createElement(LiveMapLayers, { ...props, gpsHeadingMode: false, accuracyFix: null }))
if (!withoutFix.includes('data-id="center-gps-puck-core" data-opacity="0"')) throw new Error('Missing hidden ordering anchor before GPS acquisition')
console.log(JSON.stringify(counts))
`,
    ],
    { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' },
  )
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  expect(result.exitCode).toBe(0)
  const counts = JSON.parse(result.stdout.toString())
  expect(counts).toEqual([
    { arrow: 1, dot: 1 },
    { arrow: 0, dot: 1 },
    { arrow: 0, dot: 1 },
    { arrow: 0, dot: 1 },
    { arrow: 1, dot: 1 },
  ])
})
