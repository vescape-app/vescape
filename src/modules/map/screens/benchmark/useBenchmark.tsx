import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Platform, Share, StyleSheet, View } from 'react-native'
import { useFrameCallback, useSharedValue } from 'react-native-reanimated'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { offsetCoordinate } from '@/helpers/mapGeometry'
import type { CameraEngineTarget } from '@/modules/map/lib/cameraEngine/engine'
import { advanceFakeGps, createFakeGpsState, type FakeGpsState } from '@/modules/map/lib/fakeGps'
import { SCENE_CENTER } from '@/modules/map/screens/layersPlayground/sceneData'

import {
  createBenchRecorder,
  logBenchResult,
  type BenchMeta,
  type BenchRecorder,
  type BenchResult,
} from './benchmarkRecorder'
import {
  BENCH_GPS_SPEED_KMH,
  BENCH_PHASES,
  BENCH_START_ZOOM,
  buildBenchScript,
  stormOffset,
  type BenchPhase,
} from './benchmarkScript'

/** Time for the reset camera and its tiles to settle before the clock starts. */
const SETTLE_MS = 2000
/** Deep-link start waits for the style and first tiles. */
const AUTO_START_DELAY_MS = 5000

export interface BenchDriver {
  setTarget: (target: CameraEngineTarget) => void
  snap: (target: CameraEngineTarget) => void
  /** Show the scripted fix on the map and keep the playground target in sync. */
  setFix: (center: [number, number]) => void
  setHeadingTarget: (heading: number) => void
  /** Restore default springs, derivePitch and ballistic. */
  resetTuning: () => void
  setSceneLayers: (on: boolean) => void
}

function deviceMeta(): Omit<BenchMeta, 'sdk' | 'style'> {
  const c = Platform.constants as Record<string, unknown>
  const device =
    Platform.OS === 'android'
      ? `${String(c.Manufacturer ?? '')} ${String(c.Model ?? '')}`.trim()
      : (Constants.deviceName ?? 'iOS')
  return {
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    device,
    build: __DEV__ ? 'debug' : 'release',
    appVersion: Constants.expoConfig?.version ?? '?',
  }
}

const fmt = (v: number | undefined) => (v === undefined ? '-' : String(v))

/** Compact on-screen table: one line per phase. */
export function formatBenchSummary(result: BenchResult): string {
  const rows = [
    ...BENCH_PHASES.map((p) => [p, result.phases[p]] as const),
    ['total', result.total] as const,
  ]
  const head = 'phase       js p50/p95/p99 >33  ui p95 >33  write p95  lag p95/max'
  const lines = rows.map(
    ([name, r]) =>
      `${name.padEnd(11)} ${`${r.js.p50}/${r.js.p95}/${r.js.p99}`.padEnd(15)}${String(r.js.over33).padStart(4)}  ` +
      `${fmt(r.ui?.p95).padStart(6)} ${fmt(r.ui?.over33).padStart(3)}  ${String(r.write.p95).padStart(9)}  ` +
      `${r.echo.lagP95}/${r.echo.lagMax}`,
  )
  return [`${result.sdk} · ${result.device} · ${result.build}`, head, ...lines].join('\n')
}

/**
 * Spike #658: plays the scripted run through the playground's engine and records frame pacing,
 * write cost and write-vs-echo lag. Identical on both SDKs; only `meta.sdk` and the camera adapter
 * behind `driver` differ.
 */
export function useBenchmark({
  sdk,
  style,
  driver,
  autoStart,
}: {
  sdk: string
  style: string
  driver: BenchDriver
  autoStart: boolean
}) {
  const recorderRef = useRef<BenchRecorder | null>(null)
  const driverRef = useRef(driver)
  driverRef.current = driver
  const metaRef = useRef({ sdk, style })
  metaRef.current = { sdk, style }
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<BenchResult | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  // UI-thread frame pacing: phase index + delta pairs, read back once at the end.
  const uiPhase = useSharedValue(-1)
  const uiSamples = useSharedValue<number[]>([])
  const frameCallback = useFrameCallback((info) => {
    'worklet'
    const phase = uiPhase.value
    const delta = info.timeSincePreviousFrame
    if (phase < 0 || delta === null) return
    uiSamples.modify((samples) => {
      'worklet'
      samples.push(phase, delta)
      return samples
    }, false)
  }, false)

  const run = () => {
    if (recorderRef.current) return
    const d = driverRef.current
    const recorder = createBenchRecorder()
    const script = buildBenchScript()
    let gps: FakeGpsState = createFakeGpsState(SCENE_CENTER)
    let raf = 0
    let settleTimer: ReturnType<typeof setTimeout> | undefined

    d.resetTuning()
    d.setSceneLayers(false)
    d.setFix(SCENE_CENTER)
    d.snap({ center: SCENE_CENTER, zoom: BENCH_START_ZOOM, heading: 0 })
    setResult(null)
    setStatus('settling')

    const finish = (aborted: boolean) => {
      cancelAnimationFrame(raf)
      if (settleTimer) clearTimeout(settleTimer)
      uiPhase.value = -1
      frameCallback.setActive(false)
      recorderRef.current = null
      cancelRef.current = null
      driverRef.current.setSceneLayers(false)
      if (aborted) {
        setStatus('aborted')
        return
      }
      recorder.finish(performance.now())
      const flat = uiSamples.value
      const ui = Object.fromEntries(BENCH_PHASES.map((p) => [p, [] as number[]])) as Record<
        BenchPhase,
        number[]
      >
      for (let i = 0; i < flat.length; i += 2) ui[BENCH_PHASES[flat[i]!]!].push(flat[i + 1]!)
      const summary = recorder.summarize({ ...metaRef.current, ...deviceMeta() }, ui, startedAt)
      logBenchResult(summary)
      setResult(summary)
      setStatus('done')
    }
    cancelRef.current = () => finish(true)

    let startedAt = ''
    settleTimer = setTimeout(() => {
      recorderRef.current = recorder
      uiSamples.value = []
      frameCallback.setActive(true)
      startedAt = new Date().toISOString()
      const t0 = performance.now()
      let last = t0
      let next = 0
      const tick = () => {
        const now = performance.now()
        if (now > last) recorder.jsFrame(now - last)
        last = now
        const elapsed = now - t0
        while (next < script.length && script[next]!.t <= elapsed) {
          const event = script[next++]!
          const drv = driverRef.current
          switch (event.kind) {
            case 'phase':
              recorder.setPhase(event.phase, now)
              uiPhase.value = BENCH_PHASES.indexOf(event.phase)
              setStatus(`running · ${event.phase}`)
              break
            case 'gps': {
              const sample = advanceFakeGps({
                state: gps,
                mode: 'curvy',
                speedKmh: BENCH_GPS_SPEED_KMH,
                dtSeconds: 1,
              })
              gps = sample.state
              drv.setFix(sample.reported)
              drv.setTarget({ center: sample.reported })
              break
            }
            case 'heading':
              drv.setHeadingTarget(event.heading)
              drv.setTarget({ heading: event.heading })
              break
            case 'zoom':
              drv.setTarget({ zoom: event.zoom })
              break
            case 'recenter':
              gps = createFakeGpsState(SCENE_CENTER)
              drv.setFix(SCENE_CENTER)
              drv.snap({ center: SCENE_CENTER, zoom: BENCH_START_ZOOM })
              break
            case 'jump': {
              const far = offsetCoordinate(gps.position, 90, event.meters)
              gps = { ...gps, position: far }
              drv.setFix(far)
              drv.setTarget({ center: far })
              break
            }
            case 'stormCenter': {
              const { bearing, meters } = stormOffset(event.index)
              drv.setTarget({ center: offsetCoordinate(gps.position, bearing, meters) })
              break
            }
            case 'layers':
              drv.setSceneLayers(event.on)
              break
            case 'end':
              finish(false)
              return
          }
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, SETTLE_MS)
  }

  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!autoStart) return
    const id = setTimeout(() => runRef.current(), AUTO_START_DELAY_MS)
    return () => clearTimeout(id)
  }, [autoStart])
  useEffect(() => () => cancelRef.current?.(), [])

  const json = result ? JSON.stringify(result) : ''
  const panel: ReactNode = (
    <View style={styles.panel}>
      <Text style={styles.section}>Benchmark (#658)</Text>
      <View style={styles.buttons}>
        <Button label="Run benchmark" onPress={run} size="sm" variant="primary" />
        {status.startsWith('running') || status === 'settling' ? (
          <Button
            label="Abort"
            onPress={() => cancelRef.current?.()}
            size="sm"
            variant="secondary"
          />
        ) : null}
      </View>
      {status ? <Text style={styles.stats}>{status}</Text> : null}
      {result && (
        <>
          <Text style={styles.table}>{formatBenchSummary(result)}</Text>
          <View style={styles.buttons}>
            <Button
              label="Copy JSON"
              onPress={() => void Clipboard.setStringAsync(json)}
              size="sm"
              variant="secondary"
            />
            <Button
              label="Share"
              onPress={() => void Share.share({ message: json })}
              size="sm"
              variant="secondary"
            />
          </View>
        </>
      )}
    </View>
  )

  return {
    /** The playground forwards every camera write and echo here; null when no run is active. */
    recorderRef,
    isRunning: () => recorderRef.current !== null || cancelRef.current !== null,
    panel,
  }
}

const styles = StyleSheet.create({
  panel: { gap: 8 },
  section: {
    color: theme.palette.sky.color,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginTop: 6,
  },
  stats: { color: theme.neutral.textMuted, fontSize: 11, fontFamily: 'monospace' },
  table: { color: theme.neutral.textPrimary, fontSize: 9, fontFamily: 'monospace' },
  buttons: { flexDirection: 'row', gap: 8 },
})
