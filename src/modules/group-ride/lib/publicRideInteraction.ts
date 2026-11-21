interface Cell<T> {
  get(): T
  set(value: T): void
}

export function createPublicRideInteraction({
  preview,
  initial,
  active,
  indexAt,
  onCommit,
}: {
  preview: Cell<number>
  initial: Cell<number>
  active: Cell<boolean>
  indexAt: (x: number, y: number, continuing: boolean) => number
  onCommit: (stop: number) => void
}) {
  const move = (x: number, y: number) => {
    'worklet'
    if (!active.get()) return
    const next = indexAt(x, y, true)
    if (next >= 0 && next !== preview.get()) preview.set(next)
  }
  return {
    begin(x: number, y: number) {
      'worklet'
      const next = indexAt(x, y, false)
      active.set(next >= 0)
      if (next >= 0) preview.set(next)
    },
    move,
    finish(success: boolean) {
      'worklet'
      if (!active.get()) return
      active.set(false)
      if (!success) {
        preview.set(initial.get())
        return
      }
      const next = preview.get()
      if (next !== initial.get()) {
        initial.set(next)
        onCommit(next)
      }
    },
  }
}
