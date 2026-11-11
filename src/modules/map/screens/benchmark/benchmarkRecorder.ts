/**
 * Spike #658: per-phase sample buffers and the summary shape both SDKs report.
 */
import Constants from 'expo-constants'
import { Platform } from 'react-native'

import { distanceMeters } from '@/helpers/mapGeometry'
import type { EngineCamera } from '@/modules/map/lib/cameraEngine/engine'

import { BENCH_PHASES, type BenchPhase } from './benchmarkScript'

/** Camera the map reports back after a write, from its camera-changed event. */
export interface CameraEcho {
  center: [number, number]
  zoom: number
  heading: number
  pitch: number
}

export const angleDelta = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180)

// Tolerances cover Mapbox, which reports the center rounded to 7 decimals and zoom, heading and
// pitch to 3. MapLibre echoes are exact.
const CENTER_EPS = 6e-8
const POSE_EPS = 6e-4

function centerMatches(written: EngineCamera, echo: CameraEcho): boolean {
  return (
    Math.abs(written.centerCoordinate[0] - echo.center[0]) < CENTER_EPS &&
    Math.abs(written.centerCoordinate[1] - echo.center[1]) < CENTER_EPS
  )
}

function poseMatches(written: EngineCamera, echo: CameraEcho): boolean {
  return (
    Math.abs(written.zoomLevel - echo.zoom) < POSE_EPS &&
    angleDelta(written.heading, echo.heading) < POSE_EPS &&
    Math.abs(written.pitch - echo.pitch) < POSE_EPS
  )
}

export function echoMatches(written: EngineCamera, echo: CameraEcho): boolean {
  return centerMatches(written, echo) && poseMatches(written, echo)
}

const centerMeters = (a: [number, number], b: [number, number]) =>
  distanceMeters({ longitude: a[0], latitude: a[1] }, { longitude: b[0], latitude: b[1] })

/** Writes kept to match echoes against. */
const WRITE_RING = 32

interface PhaseBuffers {
  startMs: number
  endMs: number
  jsDeltas: number[]
  writeMs: number[]
  echoes: number
  mixed: number
  lagFrames: number[]
  lagMs: number[]
  maxDrawnJumpM: number
  maxWrittenJumpM: number
}

const emptyPhase = (): PhaseBuffers => ({
  startMs: 0,
  endMs: 0,
  jsDeltas: [],
  writeMs: [],
  echoes: 0,
  mixed: 0,
  lagFrames: [],
  lagMs: [],
  maxDrawnJumpM: 0,
  maxWrittenJumpM: 0,
})

const round = (value: number, digits = 2) => {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!
}

export interface FrameStats {
  n: number
  p50: number
  p95: number
  p99: number
  max: number
  /** Frames longer than 20 ms / 33 ms. */
  over20: number
  over33: number
  /** Missed refresh slots: sum of round(delta / refresh) - 1. */
  dropped: number
}

export function frameStats(deltas: number[], refreshMs: number): FrameStats {
  const sorted = [...deltas].sort((a, b) => a - b)
  let dropped = 0
  for (const d of deltas) dropped += Math.max(0, Math.round(d / refreshMs) - 1)
  return {
    n: deltas.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.at(-1) ?? 0),
    over20: deltas.filter((d) => d > 20).length,
    over33: deltas.filter((d) => d > 33).length,
    dropped,
  }
}

export interface PhaseResult {
  ms: number
  js: FrameStats
  /** Reanimated frame callback on the UI thread. Absent when no UI samples arrived. */
  ui?: FrameStats
  write: { n: number; avg: number; p95: number; max: number }
  echo: {
    n: number
    /** Echoes whose center and pose both match a recent write (possibly different writes). */
    matched: number
    /** Matched echoes whose center came from a different write than zoom/heading/pitch. */
    mixed: number
    /** Writes between the oldest matched part of the echo and the newest write. */
    lagP50: number
    lagP95: number
    lagMax: number
    lagMsP95: number
    maxDrawnJumpM: number
    maxWrittenJumpM: number
  }
}

export interface BenchResult {
  v: 1
  sdk: string
  style: string
  platform: string
  osVersion: string
  device: string
  build: 'debug' | 'release'
  appVersion: string
  startedAt: string
  durationMs: number
  jsRefreshMs: number
  uiRefreshMs: number
  phases: Record<BenchPhase, PhaseResult>
  total: PhaseResult
  /** Replay runs on the real main map (spike #642); absent for playground runs. */
  replay?: ReplayRunInfo
}

export interface ReplayRunInfo {
  recording: string
  /** Git identity the bench script passed in the deep link; `?` when started by hand. */
  branch: string
  commit: string
  mapStyle: string
  orientation: string
  windowMs: number
  writesPerSec: number
  echoesPerSec: number
  /** Sum of absolute heading steps between consecutive writes: proof the map rotated. */
  headingTravelDeg: number
}

export type BenchMeta = Pick<
  BenchResult,
  'sdk' | 'style' | 'platform' | 'osVersion' | 'device' | 'build' | 'appVersion'
>

export function deviceMeta(): Omit<BenchMeta, 'sdk' | 'style'> {
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

/** Collects samples for one run. All timestamps are `performance.now()` ms. */
export function createBenchRecorder() {
  const phases = Object.fromEntries(BENCH_PHASES.map((p) => [p, emptyPhase()])) as Record<
    BenchPhase,
    PhaseBuffers
  >
  let phase: BenchPhase = 'follow'
  let seq = 0
  const ring: { seq: number; at: number; camera: EngineCamera }[] = []
  let lastWritten: EngineCamera | null = null
  let lastEcho: CameraEcho | null = null

  return {
    setPhase(next: BenchPhase, now: number) {
      phases[phase].endMs = now
      phase = next
      phases[next].startMs = now
    },
    finish(now: number) {
      phases[phase].endMs = now
    },
    jsFrame(deltaMs: number) {
      phases[phase].jsDeltas.push(deltaMs)
    },
    write(camera: EngineCamera, callMs: number, now: number) {
      const p = phases[phase]
      p.writeMs.push(callMs)
      if (lastWritten) {
        p.maxWrittenJumpM = Math.max(
          p.maxWrittenJumpM,
          centerMeters(lastWritten.centerCoordinate, camera.centerCoordinate),
        )
      }
      lastWritten = camera
      ring.push({ seq: ++seq, at: now, camera })
      if (ring.length > WRITE_RING) ring.shift()
    },
    echo(echo: CameraEcho, now: number) {
      const p = phases[phase]
      p.echoes++
      if (lastEcho) {
        p.maxDrawnJumpM = Math.max(p.maxDrawnJumpM, centerMeters(lastEcho.center, echo.center))
      }
      lastEcho = echo
      const newest = (matches: (written: EngineCamera, e: CameraEcho) => boolean) =>
        ring.findLast((entry) => matches(entry.camera, echo))
      const center = newest(centerMatches)
      const pose = newest(poseMatches)
      if (!center || !pose) return
      const oldest = center.seq < pose.seq ? center : pose
      if (center.seq !== pose.seq) p.mixed++
      p.lagFrames.push(seq - oldest.seq)
      p.lagMs.push(now - oldest.at)
    },
    summarize(
      meta: BenchMeta,
      uiDeltas: Record<BenchPhase, number[]>,
      startedAt: string,
    ): BenchResult {
      const allJs = BENCH_PHASES.flatMap((p) => phases[p].jsDeltas)
      const allUi = BENCH_PHASES.flatMap((p) => uiDeltas[p])
      const jsRefreshMs =
        percentile(
          [...allJs].sort((a, b) => a - b),
          50,
        ) || 16.67
      const uiRefreshMs =
        percentile(
          [...allUi].sort((a, b) => a - b),
          50,
        ) || 16.67
      const toResult = (buffers: PhaseBuffers, ui: number[]): PhaseResult => {
        const writes = [...buffers.writeMs].sort((a, b) => a - b)
        const lag = [...buffers.lagFrames].sort((a, b) => a - b)
        const lagMs = [...buffers.lagMs].sort((a, b) => a - b)
        return {
          ms: Math.round(buffers.endMs - buffers.startMs),
          js: frameStats(buffers.jsDeltas, jsRefreshMs),
          ...(ui.length > 0 && { ui: frameStats(ui, uiRefreshMs) }),
          write: {
            n: writes.length,
            avg: round(writes.reduce((s, v) => s + v, 0) / (writes.length || 1), 3),
            p95: round(percentile(writes, 95), 3),
            max: round(writes.at(-1) ?? 0, 3),
          },
          echo: {
            n: buffers.echoes,
            matched: lag.length,
            mixed: buffers.mixed,
            lagP50: percentile(lag, 50),
            lagP95: percentile(lag, 95),
            lagMax: lag.at(-1) ?? 0,
            lagMsP95: round(percentile(lagMs, 95), 1),
            maxDrawnJumpM: round(buffers.maxDrawnJumpM, 1),
            maxWrittenJumpM: round(buffers.maxWrittenJumpM, 1),
          },
        }
      }
      const merged = BENCH_PHASES.reduce<PhaseBuffers>(
        (acc, p) => {
          const b = phases[p]
          // A replay run records only `follow`; phases never entered do not bound the run.
          const entered = b.endMs > 0
          return {
            startMs: entered ? Math.min(acc.startMs, b.startMs) : acc.startMs,
            endMs: entered ? Math.max(acc.endMs, b.endMs) : acc.endMs,
            jsDeltas: acc.jsDeltas.concat(b.jsDeltas),
            writeMs: acc.writeMs.concat(b.writeMs),
            echoes: acc.echoes + b.echoes,
            mixed: acc.mixed + b.mixed,
            lagFrames: acc.lagFrames.concat(b.lagFrames),
            lagMs: acc.lagMs.concat(b.lagMs),
            maxDrawnJumpM: Math.max(acc.maxDrawnJumpM, b.maxDrawnJumpM),
            maxWrittenJumpM: Math.max(acc.maxWrittenJumpM, b.maxWrittenJumpM),
          }
        },
        { ...emptyPhase(), startMs: Infinity, endMs: -Infinity },
      )
      return {
        v: 1,
        ...meta,
        startedAt,
        durationMs: Math.round(merged.endMs - merged.startMs),
        jsRefreshMs: round(jsRefreshMs),
        uiRefreshMs: round(uiRefreshMs),
        phases: Object.fromEntries(
          BENCH_PHASES.map((p) => [p, toResult(phases[p], uiDeltas[p])]),
        ) as Record<BenchPhase, PhaseResult>,
        total: toResult(merged, allUi),
      }
    },
  }
}

export type BenchRecorder = ReturnType<typeof createBenchRecorder>

/**
 * Logcat truncates entries just above 4 KB and the iOS unified log at 1 KB, so longer results go
 * out as numbered `SPIKE_RESULT_PART` lines; `scripts/spike/compare-runs.ts` joins them.
 */
const LOG_CHUNK = Platform.OS === 'ios' ? 900 : 3900

export function logBenchResult(result: BenchResult) {
  const json = JSON.stringify(result)
  if (json.length <= LOG_CHUNK) {
    console.log(`SPIKE_RESULT ${json}`)
    return
  }
  const id = result.startedAt
  const parts = Math.ceil(json.length / LOG_CHUNK)
  for (let i = 0; i < parts; i++) {
    console.log(
      `SPIKE_RESULT_PART ${id} ${i + 1}/${parts} ${json.slice(i * LOG_CHUNK, (i + 1) * LOG_CHUNK)}`,
    )
  }
}
