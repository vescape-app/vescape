import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { CommandFailed } from './captureDriver.ts'

/** Require every outer subflow, including boot, to finish. Nested successes prove nothing. */
export function completedSmokeCommands(value: unknown, expected: number): boolean {
  if (!Array.isArray(value)) return false
  const commands = value.filter(
    (entry) => entry.metadata?.depth === 0 && entry.command?.runFlowCommand,
  )
  return (
    commands.length === expected && commands.every((entry) => entry.metadata.status === 'COMPLETED')
  )
}

export async function runSmokeMaestro(
  command: string[],
  flow: string,
  shutdownGraceMs = 60_000,
): Promise<void> {
  const expected = JSON.parse(readFileSync(flow, 'utf8').split('\n---\n')[1]).length
  // Keep artifacts under Maestro's normal upload root, isolated from previous invocations.
  const debug = join(homedir(), '.maestro', 'tests', `smoke-${Date.now()}`)
  const proc = Bun.spawn([...command.slice(0, -1), '--debug-output', debug, command.at(-1)!], {
    stdout: 'inherit',
    stderr: 'inherit',
    detached: true,
  })
  const stop = () => {
    try {
      process.kill(-proc.pid, 'SIGKILL')
    } catch {
      proc.kill('SIGKILL')
    }
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  let completedAt: number | undefined
  let stoppedAfterCompletion = false
  const started = Date.now()
  const timer = setInterval(() => {
    try {
      const files = readdirSync(debug, { recursive: true }).filter((file) =>
        String(file).endsWith('commands.json'),
      )
      if (
        files.some((file) =>
          completedSmokeCommands(
            JSON.parse(readFileSync(join(debug, String(file)), 'utf8')),
            expected,
          ),
        )
      ) {
        completedAt ??= Date.now()
      }
    } catch {
      // The reporter writes JSON while commands execute. An incomplete write is not success.
    }
    if (
      (completedAt && Date.now() - completedAt > shutdownGraceMs) ||
      Date.now() - started > 25 * 60_000
    ) {
      stoppedAfterCompletion = completedAt !== undefined
      console.warn(
        stoppedAfterCompletion
          ? '› All smoke commands passed; stopping stalled Maestro shutdown.'
          : '› Maestro execution deadline exceeded.',
      )
      stop()
    }
  }, 1000)
  try {
    const code = await proc.exited
    if (code !== 0 && !stoppedAfterCompletion) throw new CommandFailed(code || 1, command)
  } finally {
    clearInterval(timer)
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    stop()
  }
}
