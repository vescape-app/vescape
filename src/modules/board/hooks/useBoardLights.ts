import { useEffect, useState } from 'react'
import { addBoardLightsListener, setBoardLights } from 'vescape-core'

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

  useEffect(() => {
    const subscription = addBoardLightsListener((event) =>
      setState({ enabled: event.enabled, headlightsEnabled: event.headlightsEnabled }),
    )
    return () => subscription.remove()
  }, [])

  const write = (next: BoardLightsState) => {
    if (next.enabled == null || next.headlightsEnabled == null) return
    void setBoardLights(next.enabled, next.headlightsEnabled)
  }

  return {
    /** `null` while the board has not reported its lights. */
    enabled: state.enabled,
    /** `null` while the board has not reported its headlights. */
    headlightsEnabled: state.headlightsEnabled,
    setLights: (enabled: boolean) => write({ ...state, enabled }),
    setHeadlights: (headlightsEnabled: boolean) => write({ ...state, headlightsEnabled }),
  }
}
