import { useEffect, useState } from 'react'
import { addBoardLightsListener, setBoardLights } from 'vescape-core'

/**
 * The board's light switch. The board owns the state: `enabled` stays `null` until its own
 * `LIGHTS_CONTROL` echo says otherwise, so a board that never answers reads as unknown rather than
 * off. Native refuses the write unless the Board Link is trusted, so callers only gate what the
 * rider sees, never whether the board is safe to talk to.
 */
export function useBoardLights() {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    const subscription = addBoardLightsListener((event) => setEnabled(event.enabled))
    return () => subscription.remove()
  }, [])

  return {
    /** `null` while the board has not reported its lights. */
    enabled,
    toggleLights: () => void setBoardLights(!(enabled ?? false)),
  }
}
