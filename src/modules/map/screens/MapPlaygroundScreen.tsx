import { useHeadingMotionStore } from '@/modules/map/store/headingMotionStore'
import { GPS_HEADING_CAMERA_OMEGA } from '@/modules/map/constants/gpsHeadingMotion'
import {
  resetGpsDisplayPreview,
  setGpsDisplayPreviewSettings,
  updateGpsDisplayPreview,
  updateGpsDisplayPreviewSpeed,
  type GpsDisplayMotion,
} from 'vescape-core'
import { useGpsDisplayAnimator } from '@/modules/map/hooks/useGpsDisplayAnimator'
import { useGpsDisplayCameraTarget } from '@/modules/map/hooks/useGpsDisplayCameraTarget'
import { useGpsDisplayStore } from '@/modules/map/store/gpsDisplayStore'
import { GpsDisplayControls } from '@/modules/map/components/GpsDisplayControls'
import { useAppActive } from '@/hooks/useAppActive'
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
import { getPitchForProfileZoom } from '@/modules/map/lib/cameraProfiles'
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
function useHeadingOmega(mode: 'northUp' | 'gpsHeading' | 'compass') {
  const gpsSpeed = useHeadingMotionStore((s) => s.gpsCameraSpeedPercent)
  const compassSpeed = useHeadingMotionStore((s) => s.compassCameraSpeedPercent)
  const setSpeed = useHeadingMotionStore((s) => s.setSpeed)
  const [northUpOmega, setNorthUpOmega] = useState(CAMERA_ENGINE_DEFAULT_OMEGA.heading)
  const base =
    mode === 'gpsHeading' ? GPS_HEADING_CAMERA_OMEGA : CAMERA_ENGINE_DEFAULT_OMEGA.heading
  const omega =
    mode === 'northUp'
      ? northUpOmega
      : (base * (mode === 'gpsHeading' ? gpsSpeed : compassSpeed)) / 100
  const setOmega = (value: number) =>
    mode === 'northUp'
      ? setNorthUpOmega(value)
      : setSpeed(
          mode === 'gpsHeading' ? 'gpsCameraSpeedPercent' : 'compassCameraSpeedPercent',
          (value / base) * 100,
        )
  return [omega, setOmega, [base * 0.1, base * 4] as [number, number]] as const
}

function SpringSliders({
  controls,
}: {
  controls: [string, number, (value: number) => void, [number, number]?][]
}) {
  return controls.map(([label, value, onChange, range]) => (
    <PlaygroundSlider
      key={label}
      label={label}
      value={value}
      min={range?.[0] ?? 1}
      max={range?.[1] ?? 20}
      onChange={onChange}
    />
  ))
}

function JumpControls({
  jumpBy,
  recenter,
}: {
  jumpBy: (meters: number) => void
  recenter: () => void
}) {
  return (
    <View style={styles.buttons}>
      <Button label="Jump 3 km" onPress={() => jumpBy(MID_JUMP_M)} size="sm" variant="secondary" />
      <Button
        label="Teleport 100 km"
        onPress={() => jumpBy(TELEPORT_JUMP_M)}
        size="sm"
        variant="secondary"
      />
      <Button label="Reset to Wrocław" onPress={recenter} size="sm" variant="secondary" />
    </View>
  )
}

export function MapPlaygroundScreen() {
  const accents = useResolvedAccentColors()
  const appActive = useAppActive()
  const smoothingPercent = useGpsDisplayStore((s) => s.smoothingPercent)
  const predictionPercent = useGpsDisplayStore((s) => s.predictionPercent)
  const [displayMotion, setDisplayMotion] = useState<GpsDisplayMotion | null>(null)
  useEffect(() => {
    resetGpsDisplayPreview()
    return () => resetGpsDisplayPreview()
  }, [])
  useEffect(() => {
    setDisplayMotion(setGpsDisplayPreviewSettings({ smoothingPercent, predictionPercent }))
  }, [smoothingPercent, predictionPercent])
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

  const [headingMode, setHeadingMode] = useState<'northUp' | 'gpsHeading' | 'compass'>('northUp')
  const [omegaCenter, setOmegaCenter] = useState(CAMERA_ENGINE_DEFAULT_OMEGA.center)
  const [omegaZoom, setOmegaZoom] = useState(CAMERA_ENGINE_DEFAULT_OMEGA.zoom)
  const [omegaHeading, setOmegaHeading, headingRange] = useHeadingOmega(headingMode)
  const [omegaPitch, setOmegaPitch] = useState(CAMERA_ENGINE_DEFAULT_OMEGA.pitch)
  const [derivePitchOn, setDerivePitchOn] = useState(true)
  const [ballisticOn, setBallisticOn] = useState(true)
  const [zoom, setZoom] = useState(START_ZOOM)
  const [gpsMode, setGpsMode] = useState<FakeGpsMode>('curvy')
  const [gpsRunning, setGpsRunning] = useState(true)
  const [followDisplayPoint, setFollowDisplayPoint] = useState(true)
  const displayAnimator = useGpsDisplayAnimator(displayMotion, appActive)
  const [speedKmh, setSpeedKmh] = useState(20)
  const gpsHeadingRef = useRef(45)
  const [compassNoise, setCompassNoise] = useState(false)
  const [gpsFix, setGpsFix] = useState<[number, number]>(START)
  const [traces, setTraces] = useState<Traces>(emptyTraces)
  const [readout, setReadout] = useState<{ camera: EngineCamera; animating: boolean }>({
    camera: INITIAL_CAMERA,
    animating: false,
  })

  const zoomRef = useRef(zoom)
  // Drivers read live settings without restarting their timers.
  const driversRef = useRef({
    gpsMode,
    gpsRunning,
    speedKmh,
    headingMode,
    compassNoise,
    followDisplayPoint,
  })
  useEffect(() => {
    zoomRef.current = zoom
    driversRef.current = {
      gpsMode,
      gpsRunning,
      speedKmh,
      headingMode,
      compassNoise,
      followDisplayPoint,
    }
  }, [zoom, gpsMode, gpsRunning, speedKmh, headingMode, compassNoise, followDisplayPoint])

  const applyFrame = useCallback((camera: EngineCamera) => {
    cameraStateRef.current = camera
    // TODO: switch to setCameraDirect once the extended patch lands
    cameraRef.current?.setCamera({
      centerCoordinate: camera.centerCoordinate,
      zoomLevel: camera.zoomLevel,
      heading: camera.heading,
      pitch: camera.pitch,
      animationDuration: 0,
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

  // Omega is a creation-time constant, so a tuning change rebuilds the engine
  // on top of the camera the old one left behind.
  useEffect(() => {
    const engine = createCameraEngine({
      applyFrame,
      omega: {
        center: omegaCenter,
        zoom: omegaZoom,
        heading: omegaHeading,
        pitch: omegaPitch,
      },
      derivePitch: derivePitchOn
        ? (z) =>
            getPitchForProfileZoom({
              profile:
                headingMode === 'gpsHeading'
                  ? 'gpsHeading'
                  : headingMode === 'compass'
                    ? 'compass'
                    : 'northUp',
              zoom: z,
              perspectiveEnabled: true,
              enforceMinimums: false,
            })
        : undefined,
      teleportDistanceM: TELEPORT_DISTANCE_M,
      ballistic: ballisticOn ? {} : false,
    })
    engine.reset(cameraStateRef.current)
    // reset() parks every spring on the current camera; restore the live targets
    // so a retune mid-flight keeps chasing them instead of stalling.
    engine.setTarget({
      center: targetRef.current.center,
      zoom: zoomRef.current,
      heading: targetRef.current.heading,
    })
    engineRef.current = engine
    return () => {
      engine.destroy()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [
    applyFrame,
    omegaCenter,
    omegaZoom,
    omegaHeading,
    omegaPitch,
    derivePitchOn,
    ballisticOn,
    headingMode,
  ])

  useEffect(() => {
    const id = setInterval(() => {
      setDisplayMotion(updateGpsDisplayPreviewSpeed(driversRef.current.speedKmh / 3.6))
    }, 250)
    return () => clearInterval(id)
  }, [])

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
      if (speed / 3.6 >= 0.8) gpsHeadingRef.current = sample.headingDeg
      if (driversRef.current.headingMode === 'gpsHeading') {
        targetRef.current.heading = gpsHeadingRef.current
        engineRef.current?.setTarget({ heading: gpsHeadingRef.current })
      }
      if (!driversRef.current.followDisplayPoint) targetRef.current.center = sample.reported
      setGpsFix(sample.reported)
      setDisplayMotion(
        updateGpsDisplayPreview(
          sample.reported[1],
          sample.reported[0],
          speed / 3.6,
          sample.headingDeg,
          Date.now(),
        ),
      )
      if (!driversRef.current.followDisplayPoint)
        engineRef.current?.setTarget({ center: sample.reported })
    }, GPS_TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!appActive || (followDisplayPoint && displayMotion)) return
    targetRef.current.center = gpsFix
    engineRef.current?.setTarget({ center: gpsFix })
  }, [appActive, displayMotion, followDisplayPoint, gpsFix])
  const followDisplayedCenter = useCallback((coordinate: [number, number]) => {
    targetRef.current.center = coordinate
    engineRef.current?.setTarget({ center: coordinate })
    return true
  }, [])
  useGpsDisplayCameraTarget(displayMotion, appActive && followDisplayPoint, followDisplayedCenter)

  useEffect(() => {
    const id = setInterval(() => {
      const { headingMode: mode, compassNoise: noise } = driversRef.current
      if (mode !== 'compass') return
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

  useEffect(() => {
    const id = setInterval(() => {
      setTraces({ lng: [...tracesRef.current.lng], heading: [...tracesRef.current.heading] })
      setReadout({
        camera: cameraStateRef.current,
        animating: engineRef.current?.isAnimating() ?? false,
      })
    }, UI_TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const heading =
      headingMode === 'gpsHeading'
        ? gpsHeadingRef.current
        : headingMode === 'northUp'
          ? 0
          : cameraStateRef.current.heading
    targetRef.current.heading = heading
    engineRef.current?.setTarget({ heading })
  }, [headingMode])

  useEffect(() => {
    engineRef.current?.setTarget({ zoom })
  }, [zoom])

  const jumpBy = (distanceM: number) => {
    const far = offsetCoordinate(gpsStateRef.current.position, 90, distanceM)
    gpsStateRef.current = { ...gpsStateRef.current, position: far }
    targetRef.current.center = far
    setGpsFix(far)
    setDisplayMotion(
      updateGpsDisplayPreview(far[1], far[0], driversRef.current.speedKmh / 3.6, 90, Date.now()),
    )
    if (!driversRef.current.followDisplayPoint) engineRef.current?.setTarget({ center: far })
  }

  const recenter = () => {
    resetGpsDisplayPreview()
    setDisplayMotion(null)
    gpsStateRef.current = createFakeGpsState(START)
    gpsHeadingRef.current = gpsStateRef.current.courseDeg
    if (driversRef.current.headingMode === 'gpsHeading') {
      targetRef.current.heading = gpsHeadingRef.current
      engineRef.current?.setTarget({ heading: gpsHeadingRef.current })
    }
    targetRef.current.center = START
    setGpsFix(START)
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
          {displayAnimator && (
            <Mapbox.ShapeSource id="playground-display-position" shape={displayAnimator}>
              <Mapbox.CircleLayer
                id="playground-display-point"
                style={{
                  circleRadius: 7,
                  circleColor: accents.sky.color,
                  circleStrokeColor: theme.palette.mono.white,
                  circleStrokeWidth: 2,
                }}
              />
            </Mapbox.ShapeSource>
          )}
        </Mapbox.MapView>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Text style={styles.section}>GPS display · same native algorithm</Text>
        <Text>
          Violet: measured GPS. Blue: displayed position. Compare camera targets with the same
          springs.
        </Text>
        <ToggleRow
          label="Camera follows displayed point"
          value={followDisplayPoint}
          onToggle={setFollowDisplayPoint}
        />
        <Text>
          On: spring follows blue point. Off: spring follows raw GPS. No changes to the normal map.
        </Text>
        <GpsDisplayControls />
        <ChipRow
          label="Camera orientation"
          options={['northUp', 'gpsHeading', 'compass']}
          selected={headingMode}
          onSelect={(value) => setHeadingMode(value as typeof headingMode)}
        />
        <Text>
          GPS heading follows the simulated receiver course. It holds direction while stopped.
        </Text>
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
        <JumpControls jumpBy={jumpBy} recenter={recenter} />

        <Text style={styles.section}>Compass driver</Text>
        <Text>Select compass above to run the phone-heading driver at 10 Hz.</Text>
        <ToggleRow label="heading noise" value={compassNoise} onToggle={setCompassNoise} />

        <Text style={styles.section}>Springs</Text>
        <SpringSliders
          controls={[
            ['omega center', omegaCenter, setOmegaCenter],
            ['omega zoom', omegaZoom, setOmegaZoom],
            ['omega heading', omegaHeading, setOmegaHeading, headingRange],
            ['omega pitch', omegaPitch, setOmegaPitch],
          ]}
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
