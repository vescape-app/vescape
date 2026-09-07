interface BoardLightsState {
  enabled: boolean | null
  headlightsEnabled: boolean | null
}

/** Serializes complete board-light intents while native echoes remain the rendered truth. */
export function createBoardLightsWriteQueue(
  send: (enabled: boolean, headlightsEnabled: boolean) => Promise<unknown>,
  setError: (error: string | null) => void,
) {
  let reported: BoardLightsState = { enabled: null, headlightsEnabled: null }
  let desired: BoardLightsState | null = null
  let queue = Promise.resolve()
  let generation = 0
  let epoch = 0
  let disposed = false

  const invalidate = () => {
    epoch += 1
    desired = null
    reported = { enabled: null, headlightsEnabled: null }
  }
  const reset = () => {
    invalidate()
    setError(null)
  }

  return {
    setReportedState(next: BoardLightsState) {
      if (next.enabled == null || next.headlightsEnabled == null) {
        reset()
        return
      }
      reported = next
      if (
        desired?.enabled === next.enabled &&
        desired.headlightsEnabled === next.headlightsEnabled
      ) {
        desired = null
        setError(null)
      }
    },
    write(patch: Partial<BoardLightsState>) {
      if (disposed) return
      const requested = { ...(desired ?? reported), ...patch }
      if (requested.enabled == null || requested.headlightsEnabled == null) return
      desired = requested
      const intended = {
        enabled: requested.enabled,
        headlightsEnabled: requested.headlightsEnabled,
      }
      const request = ++generation
      const requestEpoch = epoch
      setError(null)
      queue = queue.then(async () => {
        if (disposed || requestEpoch !== epoch) return
        try {
          await send(intended.enabled, intended.headlightsEnabled)
        } catch {
          if (!disposed && requestEpoch === epoch && request === generation)
            setError('Board lights could not be changed.')
        }
      })
    },
    reset,
    dispose() {
      disposed = true
      invalidate()
    },
  }
}
