import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { ChipRow, ToggleRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { offsetCoordinate } from '@/helpers/mapGeometry'
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

export const PLAYGROUND_START: [number, number] = [17.0385, 51.1079]
export const PLAYGROUND_START_ZOOM = 16
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
/** Retarget stress (#655): recenter cadence and zoom sweep shape. */
const STRESS_RECENTER_MS = 300
const STRESS_SWEEP_PERIOD_S = 6
const STRESS_SWEEP_MID = 15
const STRESS_SWEEP_AMPLITUDE = 2.5
/** Written cameras kept to match native echoes against. */
const ECHO_RING = 16
const STATS_LOG_MS = 2000

interface Traces {
  lng: SpringTraceSample[]
  heading: SpringTraceSample[]
}

const emptyTraces = (): Traces => ({ lng: [], heading: [] })

const INITIAL_CAMERA: EngineCamera = {
  centerCoordinate: PLAYGROUND_START,
  zoomLevel: PLAYGROUND_START_ZOOM,
  heading: 0,
  pitch: 0,
}

/** Camera the map reports back after a write, from its camera-changed event. */
export interface CameraEcho {
  center: [number, number]
  zoom: number
  heading: number
  pitch: number
}

interface WriteStats {
  writes: number
  callMsSum: number
  callMsMax: number
  echoes: number
  matched: number
  lagSum: number
  windowStart: number
}

const emptyWriteStats = (now: number): WriteStats => ({
  writes: 0,
  callMsSum: 0,
  callMsMax: 0,
  echoes: 0,
  matched: 0,
  lagSum: 0,
  windowStart: now,
})

const angleDelta = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180)

function echoMatches(written: EngineCamera, echo: CameraEcho): boolean {
  return (
    Math.abs(written.centerCoordinate[0] - echo.center[0]) < 1e-6 &&
    Math.abs(written.centerCoordinate[1] - echo.center[1]) < 1e-6 &&
    Math.abs(written.zoomLevel - echo.zoom) < 1e-5 &&
    angleDelta(written.heading, echo.heading) < 1e-3 &&
    Math.abs(written.pitch - echo.pitch) < 1e-3
  )
}

interface CameraPlaygroundOptions {
  /** Label shown in the stats log, e.g. `maplibre`. */
  name: string
  /** Writes one engine frame to the map. */
  applyCamera: (camera: EngineCamera) => void
  cancelNativeMotion?: () => void
  /** Spike #657: lets a deep link start with the GPS driver off. */
  initialGpsRunning?: boolean
}

/**
 * Dev-only bench for `cameraEngine`, shared by the Mapbox and MapLibre playgrounds: synthetic
 * GPS/compass drivers push targets at realistic rates while the spring constants are tuned live
 * and the position vs target traces are plotted. The screen owns only the map.
 */
export function useCameraPlayground({
  name,
  applyCamera,
  cancelNativeMotion,
  initialGpsRunning = true,
}: CameraPlaygroundOptions) {
  const engineRef = useRef<CameraEngine | null>(null)
  const cameraStateRef = useRef<EngineCamera>(INITIAL_CAMERA)
  const targetRef = useRef<{ center: [number, number]; heading: number }>({
    center: PLAYGROUND_START,
    heading: 0,
  })
  const tracesRef = useRef<Traces>(emptyTraces())
  const gpsStateRef = useRef<FakeGpsState>(createFakeGpsState(PLAYGROUND_START))
  const compassElapsedRef = useRef(0)
  const writeRingRef = useRef<EngineCamera[]>([])
  const writeStatsRef = useRef<WriteStats>(emptyWriteStats(Date.now()))
  const sinkRef = useRef({ applyCamera, cancelNativeMotion })
  useEffect(() => {
    sinkRef.current = { applyCamera, cancelNativeMotion }
  }, [applyCamera, cancelNativeMotion])

  const [omegaCenter, setOmegaCenter] = useState(CAMERA_ENGINE_DEFAULT_OMEGA.center)
  const [omegaZoom, setOmegaZoom] = useState(CAMERA_ENGINE_DEFAULT_OMEGA.zoom)
  const [omegaHeading, setOmegaHeading] = useState(CAMERA_ENGINE_DEFAULT_OMEGA.heading)
  const [omegaPitch, setOmegaPitch] = useState(CAMERA_ENGINE_DEFAULT_OMEGA.pitch)
  const [derivePitchOn, setDerivePitchOn] = useState(true)
  const [ballisticOn, setBallisticOn] = useState(true)
  const [zoom, setZoom] = useState(PLAYGROUND_START_ZOOM)
  const [gpsMode, setGpsMode] = useState<FakeGpsMode>('curvy')
  const [gpsRunning, setGpsRunning] = useState(initialGpsRunning)
  const [speedKmh, setSpeedKmh] = useState(20)
  const [compassOn, setCompassOn] = useState(false)
  const [compassNoise, setCompassNoise] = useState(false)
  const [stressOn, setStressOn] = useState(false)
  const [gpsFix, setGpsFix] = useState<[number, number]>(PLAYGROUND_START)
  const [traces, setTraces] = useState<Traces>(emptyTraces)
  const [readout, setReadout] = useState<{ camera: EngineCamera; animating: boolean }>({
    camera: INITIAL_CAMERA,
    animating: false,
  })
  const [statsLine, setStatsLine] = useState('')

  const zoomRef = useRef(zoom)
  // Drivers read live settings without restarting their timers.
  const driversRef = useRef({ gpsMode, gpsRunning, speedKmh, compassOn, compassNoise, stressOn })
  useEffect(() => {
    zoomRef.current = zoom
    driversRef.current = { gpsMode, gpsRunning, speedKmh, compassOn, compassNoise, stressOn }
  }, [zoom, gpsMode, gpsRunning, speedKmh, compassOn, compassNoise, stressOn])

  const applyFrame = useCallback((camera: EngineCamera) => {
    cameraStateRef.current = camera
    const callStart = performance.now()
    sinkRef.current.applyCamera(camera)
    const callMs = performance.now() - callStart
    const stats = writeStatsRef.current
    stats.writes++
    stats.callMsSum += callMs
    stats.callMsMax = Math.max(stats.callMsMax, callMs)
    const ring = writeRingRef.current
    ring.push(camera)
    if (ring.length > ECHO_RING) ring.shift()

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

  /**
   * Feed the map's camera-changed events here. Each echo is matched against the cameras written
   * most recently: a match at lag 0 means the map holds exactly the last written camera, nothing
   * eased or coalesced in between.
   */
  const onCameraEcho = useCallback((echo: CameraEcho) => {
    const stats = writeStatsRef.current
    stats.echoes++
    const ring = writeRingRef.current
    for (let lag = 0; lag < ring.length; lag++) {
      if (echoMatches(ring[ring.length - 1 - lag]!, echo)) {
        stats.matched++
        stats.lagSum += lag
        return
      }
    }
  }, [])

  // Omega is a creation-time constant, so a tuning change rebuilds the engine
  // on top of the camera the old one left behind.
  useEffect(() => {
    const engine = createCameraEngine({
      applyFrame,
      cancelNativeMotion: () => sinkRef.current.cancelNativeMotion?.(),
      omega: {
        center: omegaCenter,
        zoom: omegaZoom,
        heading: omegaHeading,
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
    engineRef.current = engine
    return () => {
      engine.destroy()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [applyFrame, omegaCenter, omegaZoom, omegaHeading, omegaPitch, derivePitchOn, ballisticOn])

  useEffect(() => {
    const id = setInterval(() => {
      const { gpsMode: mode, gpsRunning: running, speedKmh: speed } = driversRef.current
      if (!running) return
      const sample = advanceFakeGps({
        state: gpsStateRef.current,
        mode,
        speedKmh: speed,
        dtSeconds: GPS_TICK_MS / 1000,
      })
      gpsStateRef.current = sample.state
      targetRef.current.center = sample.reported
      setGpsFix(sample.reported)
      engineRef.current?.setTarget({ center: sample.reported })
    }, GPS_TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      const { compassOn: on, compassNoise: noise } = driversRef.current
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
  }, [])

  // Retarget stress: a recenter on the last fix every 300 ms while the zoom target sweeps, on top
  // of the 1 Hz GPS and 10 Hz compass drivers. Every retarget lands mid-ease.
  useEffect(() => {
    const startedAt = Date.now()
    const id = setInterval(() => {
      if (!driversRef.current.stressOn) return
      const elapsedS = (Date.now() - startedAt) / 1000
      const sweepZoom =
        STRESS_SWEEP_MID +
        STRESS_SWEEP_AMPLITUDE * Math.sin((2 * Math.PI * elapsedS) / STRESS_SWEEP_PERIOD_S)
      engineRef.current?.setTarget({ center: targetRef.current.center, zoom: sweepZoom })
    }, STRESS_RECENTER_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setTraces({ lng: [...tracesRef.current.lng], heading: [...tracesRef.current.heading] })
      setReadout({
        camera: cameraStateRef.current,
        animating: engineRef.current?.isAnimating() ?? false,
      })
      const now = Date.now()
      const stats = writeStatsRef.current
      if (now - stats.windowStart < STATS_LOG_MS) return
      const seconds = (now - stats.windowStart) / 1000
      const line =
        `writes ${(stats.writes / seconds).toFixed(1)}/s, ` +
        `js call avg ${(stats.writes ? stats.callMsSum / stats.writes : 0).toFixed(3)}ms ` +
        `max ${stats.callMsMax.toFixed(3)}ms, ` +
        `echoes ${stats.echoes} matched ${stats.matched} ` +
        `avg lag ${(stats.matched ? stats.lagSum / stats.matched : 0).toFixed(2)} writes`
      console.log(`[camera-playground:${name}] ${line}`)
      setStatsLine(line)
      writeStatsRef.current = emptyWriteStats(now)
    }, UI_TICK_MS)
    return () => clearInterval(id)
  }, [name])

  useEffect(() => {
    engineRef.current?.setTarget({ zoom })
  }, [zoom])

  const jumpBy = (distanceM: number) => {
    const far = offsetCoordinate(gpsStateRef.current.position, 90, distanceM)
    gpsStateRef.current = { ...gpsStateRef.current, position: far }
    targetRef.current.center = far
    setGpsFix(far)
    engineRef.current?.setTarget({ center: far })
  }

  const recenter = () => {
    gpsStateRef.current = createFakeGpsState(PLAYGROUND_START)
    targetRef.current.center = PLAYGROUND_START
    setGpsFix(PLAYGROUND_START)
    engineRef.current?.snap({ center: PLAYGROUND_START, zoom })
  }

  const { camera, animating } = readout

  const renderPanel = (extra?: ReactNode): ReactNode => (
    <ScrollView style={playgroundStyles.panel} contentContainerStyle={styles.panelContent}>
      {extra}
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
        min={5}
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

      <Text style={styles.section}>Retarget stress</Text>
      <ToggleRow
        label="recenter every 300 ms + zoom sweep"
        value={stressOn}
        onToggle={setStressOn}
      />

      <Text style={styles.section}>Springs</Text>
      <PlaygroundSlider
        label="omega center"
        value={omegaCenter}
        min={1}
        max={20}
        onChange={setOmegaCenter}
      />
      <PlaygroundSlider
        label="omega zoom"
        value={omegaZoom}
        min={1}
        max={20}
        onChange={setOmegaZoom}
      />
      <PlaygroundSlider
        label="omega heading"
        value={omegaHeading}
        min={1}
        max={20}
        onChange={setOmegaHeading}
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
      <Text style={styles.stats}>{statsLine}</Text>
    </ScrollView>
  )

  /** Spike #657: move the camera through the engine, so its next frame does not undo the move. */
  const snapCamera = (center: [number, number], zoomLevel: number) => {
    targetRef.current.center = center
    setZoom(zoomLevel)
    engineRef.current?.snap({ center, zoom: zoomLevel })
  }

  return { gpsFix, panel: renderPanel(), renderPanel, snapCamera, onCameraEcho }
}

export const playgroundStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.neutral.bg },
  mapPane: { flex: 1, overflow: 'hidden' },
  map: { flex: 1 },
  panel: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: theme.neutral.border,
    backgroundColor: theme.neutral.surface,
  },
})

const styles = StyleSheet.create({
  panelContent: { padding: 12, gap: 8, paddingBottom: 32 },
  section: {
    color: theme.palette.sky.color,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginTop: 6,
  },
  stats: { color: theme.neutral.textMuted, fontSize: 11, fontFamily: 'monospace' },
  buttons: { flexDirection: 'row', gap: 8 },
})
