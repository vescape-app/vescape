import type { Navigation } from 'vescape-core'

export interface NavigationPathFrame {
  revision: number
  projected: boolean
}

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
