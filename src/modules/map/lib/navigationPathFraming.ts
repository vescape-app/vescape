import type { Navigation } from 'vescape-core'

export interface NavigationPathFrame {
  revision: number
  /** Whether the last framing started from the rider's projection rather than the path start. */
  projected: boolean
}

/**
 * Whether to frame `navigation` now. A new revision frames unless native replaced the path
 * automatically while this map visit was already open; the same revision frames once more when its
 * projection arrives, so the camera starts from the rider rather than the path start.
 */
export function navigationFrameDecision(
  previous: NavigationPathFrame | null,
  navigation: Pick<Navigation, 'revision' | 'automatic'>,
  projected: boolean,
): { frame: boolean; state: NavigationPathFrame } {
  const state = { revision: navigation.revision, projected }
  if (previous == null) return { frame: true, state }
  if (previous.revision !== navigation.revision) {
    return navigation.automatic
      ? { frame: false, state: { ...state, projected: true } }
      : { frame: true, state }
  }
  return {
    frame: projected && !previous.projected,
    state: { ...state, projected: previous.projected || projected },
  }
}
