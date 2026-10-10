/** Serialize native intents. Only one unsent drag value survives; terminal intents stay ordered. */
export function createTiltCommands(onFailure: (error: unknown) => void) {
  interface Command {
    run: () => Promise<boolean>
    hold: boolean
    resolve: (accepted: boolean) => void
  }
  const queue: Command[] = []
  let running = false

  async function drain() {
    if (running) return
    running = true
    try {
      let command: Command | undefined
      while ((command = queue.shift())) {
        try {
          const accepted = await command.run()
          if (!accepted) onFailure(new Error('Board did not accept tilt command.'))
          command.resolve(accepted)
        } catch (error) {
          onFailure(error)
          command.resolve(false)
        }
      }
    } finally {
      running = false
    }
  }

  const enqueue = (run: () => Promise<boolean>, hold = false) =>
    new Promise<boolean>((resolve) => {
      if (queue.at(-1)?.hold) queue.pop()!.resolve(false)
      queue.push({ run, hold, resolve })
      void drain()
    })
  enqueue.clear = () => {
    for (const command of queue.splice(0)) command.resolve(false)
  }
  return enqueue
}
