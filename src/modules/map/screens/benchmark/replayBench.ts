/**
 * Spike #642: frame pacing and camera-write cost of the real main map while a Debug Recording
 * replays. Same recorder and result shape as the playground benchmark (#658); the whole window
 * lands in the `follow` phase, which is what the main map is doing.
 */
import { makeMutable } from 'react-native-reanimated'
import { scheduleOnUI } from 'react-native-worklets'

import { BENCH_SDK } from './benchSdk'
import {
  angleDelta,
  createBenchRecorder,
  deviceMeta,
  logBenchResult,
  type BenchResult,
  type ReplayRunInfo,
} from './benchmarkRecorder'
import { BENCH_PHASES, type BenchPhase } from './benchmarkScript'
import { mainMapCameraProbe } from './cameraProbe'

type ReplayRunContext = Pick<
  ReplayRunInfo,
  'recording' | 'branch' | 'commit' | 'mapStyle' | 'orientation'
>

const uiActive = makeMutable(false)
const uiDeltas = makeMutable<number[]>([])

/** RN UI-thread frame deltas from the worklet runtime's own frame loop. Not the map GL thread. */
function sampleUiFrames() {
  'worklet'
  let last = -1
  const tick = (timestamp: number) => {
    if (!uiActive.value) return
    if (last >= 0) {
      const delta = timestamp - last
      uiDeltas.modify((samples) => {
        'worklet'
        samples.push(delta)
        return samples
      }, false)
    }
    last = timestamp
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

export function startReplayBench(context: ReplayRunContext) {
  const recorder = createBenchRecorder()
  const t0 = performance.now()
  recorder.setPhase('follow', t0)
  const startedAt = new Date().toISOString()
  let writes = 0
  let echoes = 0
  let headingTravelDeg = 0
  let lastHeading: number | null = null
  mainMapCameraProbe.current = {
    write(camera, callMs) {
      writes++
      if (lastHeading !== null) headingTravelDeg += angleDelta(camera.heading, lastHeading)
      lastHeading = camera.heading
      recorder.write(camera, callMs, performance.now())
    },
    echo(echo) {
      echoes++
      recorder.echo(echo, performance.now())
    },
  }

  let last = t0
  let raf = 0
  const tick = () => {
    const now = performance.now()
    if (now > last) recorder.jsFrame(now - last)
    last = now
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  uiDeltas.value = []
  uiActive.value = true
  scheduleOnUI(sampleUiFrames)

  return {
    stop(): BenchResult {
      const now = performance.now()
      cancelAnimationFrame(raf)
      mainMapCameraProbe.current = null
      uiActive.value = false
      recorder.finish(now)
      const ui = Object.fromEntries(BENCH_PHASES.map((p) => [p, [] as number[]])) as Record<
        BenchPhase,
        number[]
      >
      ui.follow = uiDeltas.value
      const result = recorder.summarize(
        { sdk: BENCH_SDK, style: context.mapStyle, ...deviceMeta() },
        ui,
        startedAt,
      )
      const seconds = (now - t0) / 1000
      result.replay = {
        ...context,
        windowMs: Math.round(now - t0),
        writesPerSec: Math.round((writes / seconds) * 10) / 10,
        echoesPerSec: Math.round((echoes / seconds) * 10) / 10,
        headingTravelDeg: Math.round(headingTravelDeg),
      }
      logBenchResult(result)
      return result
    },
  }
}
