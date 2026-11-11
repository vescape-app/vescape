import { useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { startDebugReplay, stopDebugReplay } from 'vescape-core'

import { firstReplayedFix } from '@/app/dev/watch-ride'
import { startReplayBench } from '@/modules/map/screens/benchmark/replayBench'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

type Orientation = 'northUp' | 'gpsHeading' | 'phoneHeading' | 'freeRotate'

const DEFAULT_REPLAY = 'replay-thor301.jsonl'
const DEFAULT_WINDOW_S = 120
/** First fix of the Thor 301 recording; another recording passes its own `lat`/`lon`. */
const THOR301_START = { latitude: 51.1311, longitude: 16.9901 }

let running = false

async function runReplayBench(options: {
  replay: string
  windowMs: number
  orientation: Orientation
  start: { latitude: number; longitude: number }
  branch: string
  commit: string
}) {
  const settings = useSettingsStore.getState()
  const restore = {
    autoRecording: settings.autoRecording,
    mapOrientationMode: settings.mapOrientationMode,
  }
  // A replay is a real session: auto-recording would write a ride and add its own load.
  await settings.set('autoRecording', false)
  // Course-up rotates the map with the replayed GPS bearing, the same on every run and SDK.
  await settings.set('mapOrientationMode', options.orientation)
  try {
    await startDebugReplay(options.replay)
    await firstReplayedFix(options.start)
    console.log(`[replay-bench] first fix, recording ${options.windowMs} ms`)
    const bench = startReplayBench({
      recording: options.replay,
      branch: options.branch,
      commit: options.commit,
      mapStyle: useSettingsStore.getState().mapStyleKey,
      orientation: options.orientation,
    })
    await new Promise((resolve) => setTimeout(resolve, options.windowMs))
    bench.stop()
  } finally {
    // intentional-suppression: the recording may already have ended on its own
    await stopDebugReplay().catch(() => undefined)
    await useSettingsStore.getState().set('autoRecording', restore.autoRecording)
    await useSettingsStore.getState().set('mapOrientationMode', restore.mapOrientationMode)
    console.log('[replay-bench] done')
  }
}

/**
 * Spike #642 dev-only deep link: replays a Debug Recording on the real main map and logs one
 * `SPIKE_RESULT` for `scripts/spike/compare-runs.ts`. Driven by `scripts/spike/replay-bench.ts`:
 * `vescape://dev/replay-bench?seconds=120&orientation=gpsHeading&commit=<sha>&branch=<name>`.
 */
export default function ReplayBenchLink() {
  const params = useLocalSearchParams<{
    replay?: string
    seconds?: string
    orientation?: Orientation
    lat?: string
    lon?: string
    branch?: string
    commit?: string
  }>()
  const router = useRouter()

  useEffect(() => {
    if (__DEV__ && !running) {
      running = true
      const latitude = Number(params.lat)
      const longitude = Number(params.lon)
      runReplayBench({
        replay: params.replay ?? DEFAULT_REPLAY,
        windowMs: (Number(params.seconds) || DEFAULT_WINDOW_S) * 1000,
        orientation: params.orientation ?? 'gpsHeading',
        start:
          Number.isFinite(latitude) && Number.isFinite(longitude)
            ? { latitude, longitude }
            : THOR301_START,
        branch: params.branch ?? '?',
        commit: params.commit ?? '?',
      })
        .catch((error: unknown) => console.warn('[replay-bench] failed', error))
        .finally(() => {
          running = false
        })
    }
    // The bench measures the bare main screen in its riding state.
    if (router.canDismiss()) router.dismissAll()
    router.replace('/')
    // Params are read once; a second link while running is ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
