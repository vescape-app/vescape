import { expect, test } from 'bun:test'

// Isolate native renderer stubs: Bun's module mocks otherwise leak into unrelated test files.
test('live renderer keeps one motion-driven coin and a stable trail ordering anchor', () => {
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
mock.module('@/modules/map/components/MotionComparisonLayers', () => ({ MotionComparisonLayers: () => null }))
mock.module('@/modules/map/components/MotionPuck', () => ({ MotionPuck: ({ bearing }) => createElement('motion-puck', { 'data-bearing': bearing.value }) }))
const { LiveMapLayers } = await import('./src/screens/main/map/LiveMapLayers')
const props = {
  displayRuntime: { active: true, motion: {}, now: () => 1000 },
  accuracyFix: { longitude: 0, latitude: 0 }, accuracyShape: null,
  liveTrailShape: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0,0],[1,1]] } }, puckBearing: { value: 90 }, mapPose: { value: { heading: 0, pitch: 0 } }, riders: [], highContrastRoutes: false,
}
const counts = []
// GPS, compass, north and free mode all use the same native view coin. The shared bearing
// is selected/animated upstream; no second GeoJSON arrow may survive a mode change.
for (const bearing of [90, 180, 90, 90, null]) {
  const html = renderToStaticMarkup(createElement(LiveMapLayers, { ...props, puckBearing: { value: bearing } }))
  if (!html.includes('data-id="center-live-trail-line" data-below="center-gps-puck-core"')) throw new Error('Trail is not explicitly below the rider')
  if (html.includes('center-gps-puck-heading-outline')) throw new Error('Obsolete GeoJSON arrow remains')
  counts.push({ coin: (html.match(/<motion-puck/g) ?? []).length, anchor: (html.match(/data-id="center-gps-puck-core"/g) ?? []).length })
}
const withoutFix = renderToStaticMarkup(createElement(LiveMapLayers, { ...props, accuracyFix: null }))
if (withoutFix.includes('<motion-puck')) throw new Error('Coin mounted without a position')
if (!withoutFix.includes('data-id="center-gps-puck-core" data-opacity="0"')) throw new Error('Missing hidden ordering anchor before GPS acquisition')
console.log(JSON.stringify(counts))
`,
    ],
    { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' },
  )
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  expect(result.exitCode).toBe(0)
  const counts = JSON.parse(result.stdout.toString())
  expect(counts).toEqual(Array(5).fill({ coin: 1, anchor: 1 }))
})
