export function createTuneModalOperationRunner(setPending: (pending: boolean) => void) {
  let pending = false
  return (operation: () => Promise<unknown>, onSuccess?: () => void) => {
    if (pending) return
    pending = true
    setPending(true)
    // intentional-suppression: Tune store error is rendered by the active screen or modal
    void operation()
      .then(onSuccess)
      .catch(() => undefined)
      .finally(() => {
        pending = false
        setPending(false)
      })
  }
}
