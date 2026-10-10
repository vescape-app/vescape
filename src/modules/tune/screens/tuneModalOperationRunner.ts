/** Prevents a modal action from starting twice before React can render its pending state. */
export function createTuneModalOperationRunner(setPending: (pending: boolean) => void) {
  let pending = false
  return (operation: () => Promise<unknown>, onSuccess?: () => void) => {
    if (pending) return
    pending = true
    setPending(true)
    // intentional-suppression: Tune store error is rendered by the active screen or modal
    void operation()
      .then(onSuccess)
      .catch(() => undefined) // The active Tune modal renders the store-owned failure.
      .finally(() => {
        pending = false
        setPending(false)
      })
  }
}
