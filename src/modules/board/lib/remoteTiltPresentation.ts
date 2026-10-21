import type { RemoteTiltState } from 'vescape-core'

export interface TiltPresentation {
  value: number
  durationMs: number
  phase: 'idle' | 'holding' | 'locked' | 'decaying' | 'pending'
}

// @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `REMOTE_TILT_CENTER`
// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `REMOTE_TILT_CENTER`
export const TILT_CENTER = 128

export const idleTiltPresentation: TiltPresentation = {
  value: TILT_CENTER,
  durationMs: 0,
  phase: 'idle',
}

/** One visual ramp drives both the thumb and readout. Never sends board commands. */
export function sampleTiltPresentation(presentation: TiltPresentation, progress: number) {
  'worklet'
  const remaining = Math.max(0, 1 - progress)
  const returning = presentation.phase === 'decaying'
  return {
    value: returning
      ? TILT_CENTER + (presentation.value - TILT_CENTER) * remaining
      : presentation.value,
    remainingMs: returning ? presentation.durationMs * remaining : presentation.durationMs,
  }
}

/** Finger and outstanding intents outrank snapshots. Tokens reject late command completions. */
export function createTiltPresentationOwner() {
  let revision = 0
  let owner: 'native' | 'finger' | 'pending' = 'native'
  let previous: RemoteTiltState | null | undefined

  function snapshot(state: RemoteTiltState | null): TiltPresentation | null {
    // Repeated samples of one ramp must not restart its visual clock.
    const sameRamp =
      state?.phase === 'decaying' &&
      previous?.phase === 'decaying' &&
      state.decay?.totalMs === previous.decay?.totalMs &&
      (state.decay?.elapsedMs ?? 0) >= (previous.decay?.elapsedMs ?? 0)
    const unchanged =
      previous !== undefined &&
      ((state === null && previous === null) ||
        (state?.phase !== 'decaying' &&
          state?.phase === previous?.phase &&
          state?.value === previous?.value))
    previous = state
    if (sameRamp || unchanged) return null
    if (!state) return idleTiltPresentation
    return {
      value: state.value,
      phase: state.phase,
      durationMs: state.decay ? Math.max(0, state.decay.totalMs - state.decay.elapsedMs) : 0,
    }
  }

  return {
    begin() {
      owner = 'finger'
      return ++revision
    },
    pending() {
      owner = 'pending'
      return ++revision
    },
    accept(token: number, state: RemoteTiltState | null) {
      if (token !== revision) return null
      owner = 'native'
      previous = undefined
      return snapshot(state)
    },
    readToken() {
      return owner === 'native' ? revision : null
    },
    refresh(state: RemoteTiltState | null, token = revision) {
      return owner === 'native' && token === revision ? snapshot(state) : null
    },
    fail(token: number) {
      if (token !== revision) return false
      owner = 'native'
      previous = undefined
      revision++
      return true
    },
    invalidate() {
      owner = 'native'
      previous = undefined
      revision++
    },
  }
}
