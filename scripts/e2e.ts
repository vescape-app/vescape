import { join } from 'path'
import { applicationId } from '../src/config/appVariant.ts'
import { maestroCommand } from './lib/maestro.ts'

const ROOT = join(import.meta.dir, '..')

/** Wait for this run's Metro to have a connected app, not just an open HTTP port. */
export async function waitForApp(
  port: number,
  setup: { exitCode: number | null },
  signal: AbortSignal,
  timeoutMs = 15 * 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    if (setup.exitCode !== null) {
      throw new Error(`Android E2E setup exited before the app connected (exit ${setup.exitCode}).`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
      })
      const targets = (await response.json()) as { appId?: string }[]
      if (targets.some((target) => target.appId === applicationId)) return
    } catch {
      // Metro may not exist yet while Android is building.
    }
    await Bun.sleep(500)
  }
  throw new Error('Timed out waiting for the Android E2E app to connect to Metro.')
}

async function main(): Promise<void> {
  // Fail before building if the test CLI is missing or has the wrong version.
  await maestroCommand()
  const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
  const port = reservation.port!
  await reservation.stop(true)
  const env = { ...process.env, E2E_METRO_PORT: String(port) }
  const children: Bun.Subprocess[] = []
  const abort = new AbortController()
  const interrupt = () => abort.abort(new Error('E2E interrupted.'))
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
  const start = (command: string[]) => {
    const child = Bun.spawn(command, {
      cwd: ROOT,
      env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      detached: true,
    })
    children.push(child)
    return child
  }
  try {
    console.log(`› Preparing Android E2E with its own Metro on port ${port}…`)
    const setup = start(['bun', 'run', 'android:e2e', '--port', String(port)])
    await waitForApp(port, setup, abort.signal)
    abort.signal.throwIfAborted()
    console.log('› App connected. Running E2E flows…')
    const tests = start(['bun', 'run', 'e2e:run', ...Bun.argv.slice(2)])
    const code = await Promise.race([
      tests.exited,
      new Promise<never>((_, reject) => {
        abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true })
      }),
    ])
    process.exitCode = code
  } finally {
    console.log('› Stopping E2E processes…')
    for (const child of children.reverse()) {
      try {
        // Expo and Maestro have descendants. Stop only process groups owned by this run.
        process.kill(-child.pid, 'SIGTERM')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
  }
  if (process.exitCode === 0) console.log('E2E passed.')
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
