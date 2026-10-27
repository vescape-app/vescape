import { useScreenVisible } from '@/hooks/useScreenVisible'
import { LiveGpsMotion, type MotionDiagnostics } from '@/modules/map/lib/liveMotion/motion'
import { startPointAnimation } from '@/modules/map/lib/liveMotion/pointAnimation'
import { useLiveMotionSettings } from '@/modules/map/store/liveMotionSettings'
import { LiveMotionControls } from '@/modules/map/components/LiveMotionControls'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import Mapbox, { type Camera as CameraRef } from '@rnmapbox/maps'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { ChipRow, ToggleRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { MAPBOX_ACCESS_TOKEN } from '@/config/mapy'
import { theme } from '@/constants/theme'
import { makeCircleFeature, offsetCoordinate } from '@/helpers/mapGeometry'
import { PlaygroundSlider } from '@/modules/map/components/PlaygroundSlider'
import { SpringTraceChart, type SpringTraceSample } from '@/modules/map/components/SpringTraceChart'
import {
  CAMERA_ENGINE_DEFAULT_OMEGA,
  createCameraEngine,
  type CameraEngine,
  type EngineCamera,
} from '@/modules/map/lib/cameraEngine/engine'
import { getPitchForZoom } from '@/modules/map/lib/cameraProfiles'
import {
  advanceFakeGps,
  createFakeGpsState,
  fakeCompassHeading,
  type FakeGpsMode,
  type FakeGpsState,
} from '@/modules/map/lib/fakeGps'

Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN)

const START: [number, number] = [17.0385, 51.1079]
const START_ZOOM = 16
const GPS_TICK_MS = 1000
const COMPASS_TICK_MS = 100
const UI_TICK_MS = 100
const TRACE_WINDOW_MS = 5000
/** Retargets beyond this snap instead of animating. */
const TELEPORT_DISTANCE_M = 50_000
/** Comfortably past the threshold so the button always exercises the snap path. */
const TELEPORT_JUMP_M = 100_000
/** Below the teleport threshold: exercises the ballistic zoom-out-and-back arc. */
const MID_JUMP_M = 3000
const GPS_MODES: FakeGpsMode[] = ['straight', 'curvy', 'jitter']

interface Traces {
  lng: SpringTraceSample[]
  heading: SpringTraceSample[]
}

const emptyTraces = (): Traces => ({ lng: [], heading: [] })

const INITIAL_CAMERA: EngineCamera = {
  centerCoordinate: START,
  zoomLevel: START_ZOOM,
  heading: 0,
  pitch: 0,
}

/**
 * Dev-only bench for `cameraEngine`: synthetic GPS/compass drivers push targets
 * at realistic rates while the spring constants are tuned live and the position
 * vs target traces are plotted.
 */
export function MapPlaygroundScreen() {
  const accents = useResolvedAccentColors()
  const active = useScreenVisible()
  const [motion] = useState(() => new LiveGpsMotion())
  const [pointAnimator] = useState(() => new Mapbox.__experimental.MovePointShapeAnimator(START))
  const [pointListeners] = useState(() => new Set<() => void>())
  const benchSource = useRef(1)
  const changed = useCallback(() => {
    for (const listener of pointListeners) listener()
  }, [pointListeners])
  const config = useLiveMotionSettings((state) => state.config)
  useEffect(() => {
    if (!active) return
    const at = performance.now()
    benchSource.current++
    motion.reset(benchSource.current, at)
    motion.accept(
      {
        longitude: gpsStateRef.current.position[0],
        latitude: gpsStateRef.current.position[1],
        timestamp: at,
        accuracyM: 3,
      },
      at,
      0,
      benchSource.current,
    )
    motion.configure(useLiveMotionSettings.getState().config, at)
    return startPointAnimation({
      motion,
      now: () => performance.now(),
      moveTo: (coordinate, durationMs) => pointAnimator.moveTo({ coordinate, durationMs }),
      subscribe: (listener) => {
        pointListeners.add(listener)
        return () => {
          pointListeners.delete(listener)
        }
      },
      schedule: setTimeout,
      cancel: clearTimeout,
    })
  }, [active, motion, pointAnimator, pointListeners])
  useEffect(() => {
    motion.configure(config, performance.now())
    changed()
  }, [changed, config, motion])
  const cameraRef = useRef<CameraRef>(null)
  const engineRef = useRef<CameraEngine | null>(null)
  const cameraStateRef = useRef<EngineCamera>(INITIAL_CAMERA)
  const targetRef = useRef<{ center: [number, number]; heading: number }>({
    center: START,
    heading: 0,
  })
  const tracesRef = useRef<Traces>(emptyTraces())
  const gpsStateRef = useRef<FakeGpsState>(createFakeGpsState(START))
  const compassElapsedRef = useRef(0)

  const omegaCenter = config.cameraPositionOmega
  const [omegaZoom, setOmegaZoom] = useState(CAMERA_ENGINE_DEFAULT_OMEGA.zoom)
  const omegaHeading = config.cameraHeadingOmega
  const [omegaPitch, setOmegaPitch] = useState(CAMERA_ENGINE_DEFAULT_OMEGA.pitch)
  const [derivePitchOn, setDerivePitchOn] = useState(true)
  const [ballisticOn, setBallisticOn] = useState(true)
  const [zoom, setZoom] = useState(START_ZOOM)
  const [gpsMode, setGpsMode] = useState<FakeGpsMode>('curvy')
  const [gpsRunning, setGpsRunning] = useState(true)
  const [speedKmh, setSpeedKmh] = useState(20)
  const [compassOn, setCompassOn] = useState(false)
  const [compassNoise, setCompassNoise] = useState(false)
  const [gpsFix, setGpsFix] = useState<[number, number]>(START)
  const [traces, setTraces] = useState<Traces>(emptyTraces)
  const [readout, setReadout] = useState<{
    camera: EngineCamera
    animating: boolean
    evidence: MotionDiagnostics | null
  }>({
    camera: INITIAL_CAMERA,
    animating: false,
    evidence: null,
  })

  const zoomRef = useRef(zoom)
  // Drivers read live settings without restarting their timers.
  const driversRef = useRef({ gpsMode, gpsRunning, speedKmh, compassOn, compassNoise })
  useEffect(() => {
    zoomRef.current = zoom
    driversRef.current = { gpsMode, gpsRunning, speedKmh, compassOn, compassNoise }
  }, [zoom, gpsMode, gpsRunning, speedKmh, compassOn, compassNoise])

  const applyFrame = useCallback((camera: EngineCamera) => {
    cameraStateRef.current = camera
    cameraRef.current?.setCameraDirect({
      center: camera.centerCoordinate,
      zoom: camera.zoomLevel,
      heading: camera.heading,
      pitch: camera.pitch,
    })
    const t = Date.now()
    const traceState = tracesRef.current
    traceState.lng.push({
      t,
      position: camera.centerCoordinate[0],
      target: targetRef.current.center[0],
    })
    traceState.heading.push({ t, position: camera.heading, target: targetRef.current.heading })
    const cutoff = t - TRACE_WINDOW_MS
    while (traceState.lng.length > 0 && traceState.lng[0]!.t < cutoff) traceState.lng.shift()
    while (traceState.heading.length > 0 && traceState.heading[0]!.t < cutoff) {
      traceState.heading.shift()
    }
  }, [])

  // Bench-only zoom/pitch and transit options rebuild from the current camera.
  // Shared position/heading tuning retargets the existing engine below.
  useEffect(() => {
    if (!active) return
    const engine = createCameraEngine({
      applyFrame,
      omega: {
        center: useLiveMotionSettings.getState().config.cameraPositionOmega,
        zoom: omegaZoom,
        heading: useLiveMotionSettings.getState().config.cameraHeadingOmega,
        pitch: omegaPitch,
      },
      derivePitch: derivePitchOn ? (z) => getPitchForZoom(z, true) : undefined,
      teleportDistanceM: TELEPORT_DISTANCE_M,
      ballistic: ballisticOn ? {} : false,
    })
    engine.reset(cameraStateRef.current)
    // reset() parks every spring on the current camera; restore the live targets
    // so a retune mid-flight keeps chasing them instead of stalling.
    engine.setTarget({
      center: targetRef.current.center,
      zoom: zoomRef.current,
      ...(driversRef.current.compassOn ? { heading: targetRef.current.heading } : {}),
    })
    engine.follow(() => ({
      center: motion.position(performance.now()) ?? targetRef.current.center,
      ...(driversRef.current.compassOn
        ? {}
        : { heading: motion.cameraHeading(performance.now()) ?? engine.getCamera().heading }),
    }))
    engineRef.current = engine
    return () => {
      engine.destroy()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [active, applyFrame, motion, omegaZoom, omegaPitch, derivePitchOn, ballisticOn])

  useEffect(() => {
    engineRef.current?.configureOmega({
      center: useLiveMotionSettings.getState().config.cameraPositionOmega,
      heading: omegaHeading,
    })
  }, [omegaCenter, omegaHeading])

  useEffect(() => {
    const id = setInterval(() => {
      const { gpsMode: mode, gpsRunning: running, speedKmh: speed } = driversRef.current
      if (!running || !active) return
      const sample = advanceFakeGps({
        state: gpsStateRef.current,
        mode,
        speedKmh: speed,
        dtSeconds: GPS_TICK_MS / 1000,
      })
      gpsStateRef.current = sample.state
      targetRef.current.center = sample.reported
      setGpsFix(sample.reported)
      const at = performance.now()
      motion.accept(
        {
          longitude: sample.reported[0],
          latitude: sample.reported[1],
          timestamp: at,
          accuracyM: mode === 'jitter' ? 12 : 3,
        },
        at,
        0,
        benchSource.current,
      )
      changed()
    }, GPS_TICK_MS)
    return () => clearInterval(id)
  }, [active, changed, motion])

  useEffect(() => {
    const id = setInterval(() => {
      if (!active) return
      const { compassOn: on, compassNoise: noise, speedKmh: speed } = driversRef.current
      const at = performance.now()
      motion.updateSpeed(speed / 3.6, at, at, benchSource.current)
      changed()
      if (!on) return
      compassElapsedRef.current += COMPASS_TICK_MS / 1000
      const heading = fakeCompassHeading({
        elapsedS: compassElapsedRef.current,
        degPerSecond: 12,
        noiseDeg: noise ? 6 : 0,
      })
      targetRef.current.heading = heading
      engineRef.current?.setTarget({ heading })
    }, COMPASS_TICK_MS)
    return () => clearInterval(id)
  }, [active, changed, motion])

  useEffect(() => {
    const id = setInterval(() => {
      if (!active) return
      setTraces({ lng: [...tracesRef.current.lng], heading: [...tracesRef.current.heading] })
      setReadout({
        camera: cameraStateRef.current,
        animating: engineRef.current?.isAnimating() ?? false,
        evidence: motion.diagnostics(performance.now()),
      })
    }, UI_TICK_MS)
    return () => clearInterval(id)
  }, [active, motion])

  useEffect(() => {
    engineRef.current?.setTarget({ zoom })
  }, [zoom])

  const jumpBy = (distanceM: number) => {
    const far = offsetCoordinate(gpsStateRef.current.position, 90, distanceM)
    gpsStateRef.current = { ...gpsStateRef.current, position: far }
    targetRef.current.center = far
    setGpsFix(far)
    const at = performance.now()
    benchSource.current++
    motion.reset(benchSource.current, at)
    motion.accept(
      { longitude: far[0], latitude: far[1], timestamp: at, accuracyM: 3 },
      at,
      0,
      benchSource.current,
    )
    changed()
    engineRef.current?.setTarget({ center: far })
  }

  const recenter = () => {
    gpsStateRef.current = createFakeGpsState(START)
    targetRef.current.center = START
    setGpsFix(START)
    const at = performance.now()
    benchSource.current++
    motion.reset(benchSource.current, at)
    motion.accept(
      { longitude: START[0], latitude: START[1], timestamp: at, accuracyM: 3 },
      at,
      0,
      benchSource.current,
    )
    changed()
    engineRef.current?.snap({ center: START, zoom })
  }

  const { camera, animating } = readout

  return (
    <View style={styles.screen}>
      <View style={styles.mapPane}>
        <Mapbox.MapView
          style={styles.map}
          styleURL={Mapbox.StyleURL.Dark}
          scaleBarEnabled={false}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
        >
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{
              centerCoordinate: START,
              zoomLevel: START_ZOOM,
              heading: 0,
              pitch: 0,
            }}
            animationMode="none"
          />
          <Mapbox.ShapeSource
            id="playground-fix"
            shape={makeCircleFeature(gpsFix[0], gpsFix[1], 8)}
          >
            <Mapbox.FillLayer
              id="playground-fix-fill"
              style={{
                fillColor: accents.violet.color,
                fillOutlineColor: accents.violet.light,
              }}
            />
          </Mapbox.ShapeSource>
          <Mapbox.ShapeSource id="playground-display" shape={pointAnimator}>
            <Mapbox.CircleLayer
              id="playground-display-point"
              style={{ circleRadius: 5, circleColor: accents.green.color }}
            />
          </Mapbox.ShapeSource>
        </Mapbox.MapView>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Text style={styles.section}>GPS driver</Text>
        <ChipRow
          label="mode"
          options={GPS_MODES}
          selected={gpsMode}
          onSelect={(value) => setGpsMode(value as FakeGpsMode)}
        />
        <ToggleRow label="running (1 Hz)" value={gpsRunning} onToggle={setGpsRunning} />
        <PlaygroundSlider
          label="speed"
          value={speedKmh}
          min={0}
          max={50}
          step={1}
          color={theme.palette.green.color}
          format={(v) => `${v.toFixed(0)} km/h`}
          onChange={setSpeedKmh}
        />
        <View style={styles.buttons}>
          <Button
            label="Jump 3 km"
            onPress={() => jumpBy(MID_JUMP_M)}
            size="sm"
            variant="secondary"
          />
          <Button
            label="Teleport 100 km"
            onPress={() => jumpBy(TELEPORT_JUMP_M)}
            size="sm"
            variant="secondary"
          />
          <Button label="Reset to Wrocław" onPress={recenter} size="sm" variant="secondary" />
        </View>

        <Text style={styles.section}>Compass driver</Text>
        <ToggleRow label="phone heading (10 Hz)" value={compassOn} onToggle={setCompassOn} />
        <ToggleRow label="heading noise" value={compassNoise} onToggle={setCompassNoise} />

        <Text style={styles.section}>Springs</Text>
        <PlaygroundSlider
          label="omega zoom"
          value={omegaZoom}
          min={1}
          max={20}
          onChange={setOmegaZoom}
        />
        <PlaygroundSlider
          label="omega pitch"
          value={omegaPitch}
          min={1}
          max={20}
          onChange={setOmegaPitch}
        />
        <PlaygroundSlider
          label="zoom target"
          value={zoom}
          min={10}
          max={19}
          color={theme.palette.amber.color}
          format={(v) => v.toFixed(1)}
          onChange={setZoom}
        />
        <ToggleRow
          label="derivePitch (zoom→pitch)"
          value={derivePitchOn}
          onToggle={setDerivePitchOn}
        />
        <ToggleRow label="ballistic transit zoom" value={ballisticOn} onToggle={setBallisticOn} />

        <LiveMotionControls evidence={readout.evidence} />
        <Text style={styles.section}>Telemetry</Text>
        <SpringTraceChart
          label="center lng"
          samples={traces.lng}
          windowMs={TRACE_WINDOW_MS}
          format={(v) => v.toFixed(5)}
        />
        <SpringTraceChart
          label="heading"
          samples={traces.heading}
          windowMs={TRACE_WINDOW_MS}
          format={(v) => `${v.toFixed(1)}°`}
        />
        <ValueRow
          label="center"
          value={`${camera.centerCoordinate[0].toFixed(5)}, ${camera.centerCoordinate[1].toFixed(5)}`}
        />
        <ValueRow label="zoom" value={camera.zoomLevel.toFixed(3)} />
        <ValueRow label="heading" value={`${camera.heading.toFixed(1)}°`} />
        <ValueRow label="pitch" value={`${camera.pitch.toFixed(1)}°`} />
        <ValueRow label="isAnimating" value={animating ? 'true' : 'false'} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.neutral.bg },
  mapPane: { flex: 1, overflow: 'hidden' },
  map: { flex: 1 },
  panel: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: theme.neutral.border,
    backgroundColor: theme.neutral.surface,
  },
  panelContent: { padding: 12, gap: 8, paddingBottom: 32 },
  section: {
    color: theme.palette.sky.color,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginTop: 6,
  },
  buttons: { flexDirection: 'row', gap: 8 },
})
