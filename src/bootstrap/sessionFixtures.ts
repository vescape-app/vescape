import { useEffect, useState } from 'react'
import { restoreDatabase, startDebugReplay, updateSetting } from 'vescape-core'

import { fixtureSession } from '@/config/env'
import { fixtureDatabaseFile, fixtureReplayName, fixtureUri } from '@/config/fixtureSession'
import { REPLAY_WARMUP_MS, REPLAY_WARMUP_SPEED } from '@/config/replayWarmup'

async function applyFixtures(): Promise<void> {
  if (fixtureDatabaseFile) {
    await restoreDatabase(fixtureUri(fixtureDatabaseFile))
  }
  // Warm the live charts so the screens have a filled window instead of the empty sparklines a
  // session that just connected would show. Native fast-forwards the recording's opening stretch
  // (see `@/config/replayWarmup`), then plays on at 1x.
  if (fixtureReplayName) {
    // A replay session is a real session to `RecordingCoordinator`, so auto-recording would write a
    // synthetic ride into the history this run is about to read. The guard belongs to the replay,
    // not to the restore — a replay-only build (no fixture zip) records one just the same. It must
    // still come after any restore, because the restore swaps the database settings live in.
    await updateSetting('autoRecording', false)
    await startDebugReplay(fixtureReplayName, {
      warmupMs: REPLAY_WARMUP_MS,
      warmupSpeed: REPLAY_WARMUP_SPEED,
    })
  }
}

/**
 * Stages a fixture run's data before the app boots: restores the pushed backup zip (history,
 * boards, tunes, alerts) and starts the Debug Recording replay that feeds the live screens. Both
 * the screenshot capture and the smoke run come up this way.
 *
 * Returns `true` immediately in every normal build. In a fixture build the caller holds the app
 * unmounted until this resolves, so the stores read the restored database on their first load
 * instead of racing a mid-flight database swap.
 */
export function useSessionFixtures(): boolean {
  const [ready, setReady] = useState(!fixtureSession)

  useEffect(() => {
    if (!fixtureSession) return
    let cancelled = false
    void (async () => {
      try {
        await applyFixtures()
      } catch (error) {
        // A broken fixture must not brick the run — boot anyway so the failure is visible on screen.
        console.warn('[fixtures] setup failed', error)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return ready
}
