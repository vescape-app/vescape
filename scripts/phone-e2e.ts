import { applicationId } from '../src/config/appVariant.ts'
import { maestroCommand } from './lib/maestro.ts'
import { withE2eSession } from './lib/e2eSession.ts'

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
  const args = Bun.argv.slice(2)
  const deviceFlag = args.indexOf('--device')
  const device = deviceFlag < 0 ? [] : args.splice(deviceFlag, 2)
  if (device.length && !device[1]) throw new Error('--device requires a name or serial')
  await withE2eSession(async (session) => {
    const port = await session.port()
    session.env.E2E_METRO_PORT = String(port)
    session.env.EXPO_PUBLIC_E2E = '1'
    console.log(`› Preparing Android E2E with its own Metro on port ${port}…`)
    const setup = session.start(['bun', 'run', 'android:e2e', ...device, '--port', String(port)])
    await waitForApp(port, setup, session.abort.signal)
    console.log('› App connected. Running E2E flows…')
    await session.run(['bun', 'run', 'e2e:run', ...device, ...args])
  })
  process.exitCode = 0
  if (process.exitCode === 0) console.log('E2E passed.')
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
