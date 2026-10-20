import type { Navigation } from 'vescape-core'

export interface NavigationPathFrame {
  computedAtMs: number
  cameraRevision: number
  projected: boolean
}

/** Native revisions distinguish explicit path changes from automatic replacements. */
export function navigationFrameDecision(
  previous: NavigationPathFrame | null,
  navigation: Pick<Navigation, 'computedAtMs' | 'cameraRevision'>,
  projected: boolean,
): { frame: boolean; state: NavigationPathFrame } {
  const state = { ...navigation, projected }
  const sameRevision = previous?.cameraRevision === navigation.cameraRevision
  if (sameRevision && (previous.computedAtMs !== navigation.computedAtMs || previous.projected)) {
    // A replacement's progress may arrive separately. It must not schedule a later camera jump.
    return { frame: false, state: { ...state, projected: true } }
  }
  return { frame: !sameRevision || projected, state }
}
