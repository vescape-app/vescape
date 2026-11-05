import { expect, test } from 'bun:test'

// Keep native host mocks out of other tests. Hooks, springs, segment evaluation, point adapter,
// MotionPuck and GpsPuck are production code; only the native render/sensor boundary is replaced.
test('heading hooks integrate camera ownership, mode transitions and mounted GPS arrow presentation', () => {
  const result = Bun.spawnSync(
    [
      'bun',
      '-e',
      `
import { mock, expect } from 'bun:test'
import React from 'react'
import { create, act } from ${JSON.stringify(import.meta.resolve('react-test-renderer'))}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let time = 0, nextFrame = 0
const frames = new Map()
globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame }
globalThis.cancelAnimationFrame = handle => frames.delete(handle)
Date.now = () => time
Object.defineProperty(performance, 'now', { value: () => time, configurable: true })
const shared = initial => {
  const ref = React.useRef(null)
  if (!ref.current) ref.current = { value: initial, get() { return this.value }, set(value) { this.value = value } }
  return ref.current
}
mock.module('react-native', () => ({
  View: 'View', useWindowDimensions: () => ({ width: 400, height: 800 }),
  StyleSheet: { create: x => x, absoluteFill: {} },
}))
mock.module('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', createAnimatedComponent: x => x },
  useSharedValue: shared,
  useAnimatedProps: fn => ({ get coordinate() { return fn().coordinate } }),
  useAnimatedStyle: fn => fn(),
  useDerivedValue: fn => ({ get value() { return fn() } }),
  withTiming: value => value, Easing: { linear: x => x },
}))
mock.module('@shopify/react-native-skia', () => ({
  Canvas: 'Canvas', Group: 'SkiaGroup', Path: 'Path',
  Skia: { Path: { MakeFromSVGString: x => x }, Matrix: () => ({
    translate() {}, scale() {}, rotate(angle) { this.rotation = angle },
  }) },
}))
mock.module('@rnmapbox/maps/lib/module/specs/RNMBXMarkerViewNativeComponent', () => ({ default: 'NativeMarker' }))
mock.module('@rnmapbox/maps/lib/module/specs/RNMBXMarkerViewContentNativeComponent', () => ({ default: 'NativeContent' }))
mock.module('@rnmapbox/maps', () => ({ default: { StyleURL: { SatelliteStreet: 'satellite' } } }))
mock.module('phosphor-react-native', () => ({ MapTrifoldIcon: () => null, MountainsIcon: () => null, PlanetIcon: () => null }))
const config = { cameraPositionOmega: 3, cameraHeadingOmega: 1, arrowHeadingOmega: 10 }
mock.module('@/modules/map/store/liveMotionSettings', () => ({ useLiveMotionSettings: Object.assign(selector => selector({ config }), { getState: () => ({ config }) }) }))
// Unrelated intents are excluded; the live camera controller and its follow hook remain real.
mock.module('@/screens/main/map/useHistoryCameraFraming', () => ({ useHistoryCameraFraming: () => ({}) }))
mock.module('@/screens/main/map/useCameraPreviewGestures', () => ({ useCameraPreviewGestures: ({ cameraRefs }) => ({ previewPanActiveRef: cameraRefs.previewPanActiveRef }) }))
mock.module('@/screens/main/map/useCameraIntentCommands', () => ({ useCameraIntentCommands: () => ({}) }))
mock.module('@/screens/main/map/useMainMapImperativeHandle', () => ({ useMainMapImperativeHandle: () => {} }))
let sensor = null, subscriptions = 0, removals = 0, appActive = true
mock.module('@/hooks/useAppActive', () => ({ useAppActive: () => appActive }))
mock.module('@/modules/map/lib/deviceMotionPhoneHeadingAdapter', () => ({ deviceMotionPhoneHeadingAdapter: {
  headingOffsetDeg: 0, isAvailableAsync: async () => true,
  getPermissionsAsync: async () => ({ status: 'granted' }),
  requestPermissionsAsync: async () => ({ status: 'granted' }),
  setUpdateInterval: interval => expect(interval).toBe(33),
  addListener: listener => { sensor = listener; subscriptions++; return { remove() { sensor = null; removals++ } } },
} }))
const { useCameraControls } = await import('./src/screens/main/map/useCameraControls')
const { usePuckBearing } = await import('./src/screens/main/map/usePuckBearing')
const { usePhoneHeading } = await import('./src/modules/map/hooks/usePhoneHeading')
const { MotionDisplay } = await import('./src/modules/map/lib/liveMotion/display')
const { MotionPuck } = await import('./src/modules/map/components/MotionPuck')
let snapshot = {
  id: 'live', source: 1, revision: 1, localClockMs: 0, clockMs: 0, clockRate: 1,
  position: [0, 0], segments: [], cameraHeading: 90, pointHeading: 90,
  headingUntilMs: 20000, diagnostics: null, raw: null, trail: [],
}
let receive
const motion = new MotionDisplay('live', {
  command: () => snapshot, subscribe: listener => { receive = listener; return { remove() {} } },
}, () => time)
motion.connect(); motion.command({})
const runtime = { motion, now: motion.now, subscribe: motion.subscribe, duration: motion.duration, active: true }
let fix = { longitude: 0, latitude: 0, timestamp: 0, accuracyM: 3 }
const writes = []
let controls, bearing, pose, phone = 0, mode = 'phoneHeading', active = true, history = false, approximate = false, updatesEnabled = false
const getFollowDeg = () => mode === 'phoneHeading' ? phone : mode === 'gpsHeading' ? motion.cameraHeading(motion.now()) : 0
const host = { cancelCameraAnimations() {}, setCameraDirect(camera) { writes.push({ at: time, ...camera }); pose.set({ heading: camera.heading, pitch: camera.pitch }) } }
function App() {
  controls = useCameraControls({
    ref: null, cameraFix: fix, displayMotion: motion, displayNow: motion.now,
    displayActive: active, persistedFallback: null, perspectiveEnabled: false,
    mapViewport: { width: 400, height: 800 }, mapOrientationMode: mode,
    heading: { getFollowDeg, phoneReady: true, resetOnRecenter: mode !== 'freeRotate' },
    history: { active: history, preview: null, previewRoute: [], rideRoute: [], focusRoute: [], selectionKey: null },
    follow: { updatesEnabled }, getViewfinderCoordinateFromMap: async () => ({ latitude: 0, longitude: 0 }),
    onHeadingChange() {}, onPerspectiveChange() {},
  })
  pose = shared({ heading: 0, pitch: 0 })
  bearing = usePuckBearing({ approximateFix: approximate, displayRuntime: runtime })
  usePhoneHeading({ active: active && mode === 'phoneHeading', followCamera: controls.followGps,
    onHeadingChange: value => { if (value != null) phone = value },
    onFollowHeading: heading => controls.engine.setTarget({ heading }), onStatusChange() {},
  })
  return React.createElement(MotionPuck, { displayRuntime: runtime, fallbackCoordinate: [0,0], color: 'test', bearing, mapPose: pose })
}
let root
const render = async () => { await act(async () => { if (root) root.update(React.createElement(App)); else root = create(React.createElement(App)) }) }
await render()
controls.cameraRef.current = host
controls.engine.reset({ centerCoordinate: [0,0], zoomLevel: 16, heading: 0, pitch: 0 })
const tick = () => { time += 16; const batch = [...frames.values()]; frames.clear(); act(() => { for (const callback of batch) callback(time) }) }
const run = count => { for (let i=0;i<count;i++) tick() }
const emit = patch => { snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1, localClockMs: time, clockMs: time }; act(() => receive(snapshot)) }
const input = heading => act(() => sensor?.({ rotation: { alpha: -heading * Math.PI / 180, beta: 0, gamma: 0, timestamp: time }, orientation: 0 }))
const group = () => root.root.findByType('SkiaGroup').props
run(150)
expect(bearing.get()).toBeCloseTo(90,1)
// Same mounted native marker/Skia group: expire, reacquire unchanged north/east, interrupt a turn.
const marker = root.root.findByType('NativeMarker')
for (const angle of [90, 0]) {
  emit({ pointHeading: angle, headingUntilMs: time + 20000 }); run(200)
  emit({ headingUntilMs: time }); expect(group().opacity.value).toBe(0)
  emit({ headingUntilMs: time + 20000 }); expect(group().opacity.value).toBe(1)
  expect(bearing.get()).toBeCloseTo(angle,1)
}
emit({ pointHeading: 180, headingUntilMs: time + 20000 }); run(5)
const unfinished = bearing.get()
emit({ headingUntilMs: time }); expect(group().opacity.value).toBe(0)
emit({ headingUntilMs: time + 20000 }); expect(bearing.get()).toBe(unfinished)
run(200)
expect(root.root.findByType('NativeMarker')).toBe(marker)
expect(frames.size).toBe(0)
// Compass runs on sensor input without any new native display publication, including idle wake.
const revision = snapshot.revision
const start = time, firstWrite = writes.length
for (let i=0;i<120;i++) { if (i%2===0) input(i); tick() }
expect(snapshot.revision).toBe(revision)
expect(controls.engine.getCamera().heading).toBeGreaterThan(80)
const trace = writes.slice(firstWrite)
expect(trace.length).toBeGreaterThan(80)
expect(trace[0].at - start).toBeLessThan(100)
for (let i=1;i<trace.length;i++) expect(trace[i].at-trace[i-1].at).toBeLessThan(100)
expect(bearing.get()).toBeCloseTo(180,1)
expect(group().matrix.value.rotation).toBeCloseTo((bearing.get()-pose.get().heading)*Math.PI/180,6)
expect(subscriptions).toBe(1)
// Position segments and compass targets coexist, even with a faster replay display clock.
emit({ clockRate: 4, segments: [{ startMs: time, endMs: time + 400, from: [0,0], to: [0.0001,0] }] })
input(160); run(100)
expect(controls.engine.getCamera().centerCoordinate[0]).toBeGreaterThan(0)
expect(controls.engine.getCamera().heading).toBeGreaterThan(100)
// Every pair retargets from the drawn camera; north crossing and rapid in-flight changes stay continuous.
for (const from of ['phoneHeading','gpsHeading','northUp','freeRotate']) {
  for (const to of ['phoneHeading','gpsHeading','northUp','freeRotate']) {
    mode = from; await render(); run(400)
    controls.engine.reset({ ...controls.engine.getCamera(), heading: 359 })
    phone = 1; emit({ cameraHeading: 1 })
    mode = to; await render()
    const before = controls.engine.getCamera()
    tick()
    const after = controls.engine.getCamera()
    const delta = ((after.heading - before.heading + 540) % 360) - 180
    expect(Math.abs(delta)).toBeLessThan(0.1)
    if (to === 'gpsHeading') expect(after.heading).not.toBe(1)
    run(5)
  }
}
// A hidden retained map must not restart its writer on measured GPS React updates.
// Replay navigation can retain the old home beneath the new one; only the visible one follows.
mode = 'phoneHeading'; updatesEnabled = true; await render(); run(300)
active = false; runtime.active = false; await render(); run(5)
const hiddenGpsWrites = writes.length
for (let i=0;i<3;i++) {
  emit({ position: [0.001 + i * 0.0001,0], segments: [] })
  fix = { ...fix, timestamp: time, longitude: 0.001 + i * 0.0001 }
  await render(); run(60)
}
expect(writes.length).toBe(hiddenGpsWrites)
// Orientation changes on a hidden retained map cannot claim its native camera either.
mode = 'northUp'; await render(); run(10)
expect(writes.length).toBe(hiddenGpsWrites)
active = true; runtime.active = true; updatesEnabled = false; await render(); run(300)
expect(controls.engine.getCamera().heading).toBeCloseTo(0,2)
// Manual browsing and History do not let sensor/segment updates reclaim the camera.
act(() => controls.setFollowGps(false)); controls.engine.stop()
mode = 'phoneHeading'; await render()
const manual = controls.engine.getCamera()
input(220); emit({ cameraHeading: 240 }); run(20)
expect(controls.engine.getCamera()).toEqual(manual)
history = true; active = false; runtime.active = false; await render(); motion.notify(); run(10)
const hidden = writes.length
input(270); emit({ pointHeading: 270 }); run(20)
expect(writes.length).toBe(hidden)
expect(sensor).toBeNull()
expect(frames.size).toBe(0)
// Foreground reacquires the sensor and wakes the retained camera owner.
history = false; active = true; runtime.active = true; act(() => controls.setFollowGps(true)); await render()
input(270); run(100)
expect(writes.length).toBeGreaterThan(hidden)
emit({ headingUntilMs: time + 20000 });
approximate = true; await render(); expect(group().opacity.value).toBe(0)
approximate = false; await render(); expect(group().opacity.value).toBe(1)
appActive = false; active = false; runtime.active = false; await render()
expect(sensor).toBeNull()
await act(async () => root.unmount())
expect(removals).toBe(subscriptions)
expect(frames.size).toBe(0)
console.log('heading integration passed')
`,
    ],
    { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe', timeout: 20000 },
  )
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  expect(result.stdout.toString()).toContain('heading integration passed')
})
