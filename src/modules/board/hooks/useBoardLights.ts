import { useEffect, useRef, useState } from 'react'
import { addBoardLightsListener, setBoardLights } from 'vescape-core'
import { createBoardLightsWriteQueue } from './boardLightsWriteQueue'

interface BoardLightsState {
  enabled: boolean | null
  headlightsEnabled: boolean | null
}

/**
 * The board's light switches. The board owns the state: both stay `null` until its own
 * `LIGHTS_CONTROL` echo says otherwise, so a board that never answers reads as unknown rather than
 * off. Native refuses the write unless the Board Link is trusted, so callers only gate what the
 * rider sees, never whether the board is safe to talk to.
 *
 * A write always states both switches, so flipping one sends the other's current value alongside —
 * which is why neither setter does anything until both are known.
 */
export function useBoardLights() {
  const [state, setState] = useState<BoardLightsState>({ enabled: null, headlightsEnabled: null })
  const [error, setError] = useState<string | null>(null)
  const writerRef = useRef<ReturnType<typeof createBoardLightsWriteQueue> | null>(null)
  if (writerRef.current == null)
    writerRef.current = createBoardLightsWriteQueue(setBoardLights, setError)

  useEffect(() => {
    const subscription = addBoardLightsListener((event) => {
      const next = { enabled: event.enabled, headlightsEnabled: event.headlightsEnabled }
      writerRef.current?.setReportedState(next)
      setState(next)
    })
    return () => {
      writerRef.current?.dispose()
      subscription.remove()
    }
  }, [])

  return {
    /** `null` while the board has not reported its lights. */
    enabled: state.enabled,
    /** `null` while the board has not reported its headlights. */
    headlightsEnabled: state.headlightsEnabled,
    error,
    setLights: (enabled: boolean) => writerRef.current?.write({ enabled }),
    setHeadlights: (headlightsEnabled: boolean) => writerRef.current?.write({ headlightsEnabled }),
  }
}
