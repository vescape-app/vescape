import { useEffect, useState } from 'react'
import { restoreDatabase, startDebugReplay, updateSetting } from 'vescape-core'

import { fixtureSession, previewMode } from '@/config/env'
import { fixtureDatabaseFile, fixtureReplayName, fixtureUri } from '@/config/fixtureSession'
import { PREVIEW_WARMUP_MS, REPLAY_WARMUP_MS } from '@/config/replayWarmup'

async function applyFixtures(): Promise<void> {
  if (fixtureDatabaseFile) {
    await restoreDatabase(fixtureUri(fixtureDatabaseFile))
  }
  if (fixtureReplayName) {
    await updateSetting('autoRecording', false)
    if (previewMode) {
      await updateSetting('companionPresenceEnabled', false)
      await updateSetting('autoConnect', false)
      await updateSetting('themeMode', 'dark')
    }
    await startDebugReplay(fixtureReplayName, {
      warmupMs: previewMode ? PREVIEW_WARMUP_MS : REPLAY_WARMUP_MS,
    })
  }
}

export function useSessionFixtures(): boolean {
  const [ready, setReady] = useState(!fixtureSession)

  useEffect(() => {
    if (!fixtureSession) return
    let cancelled = false
    void (async () => {
      try {
        await applyFixtures()
      } catch (error) {
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
