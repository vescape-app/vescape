import { join } from 'path'
import { openSync, closeSync } from 'fs'
import { adb, removeReversePorts } from './androidUiE2e.ts'
import { listAdbDevices } from './devices.ts'

export interface SessionIO {
  devices: () => { serial: string }[]
  adb: typeof adb
}
const defaultIO: SessionIO = { devices: listAdbDevices, adb }

const ROOT = join(import.meta.dir, '../..')

/** Each suite owns its processes and temporary device listeners, including on cancellation. */
export async function withE2eSession<T>(
  action: (session: E2eSession) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
  io: SessionIO = defaultIO,
): Promise<T> {
  const session = new E2eSession(env, io)
  const interrupt = () => session.abort.abort(new Error('E2E interrupted'))
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
  try {
    return await action(session)
  } finally {
    try {
      await session.close()
    } finally {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', interrupt)
    }
  }
}

export class E2eSession {
  readonly abort = new AbortController()
  readonly env: NodeJS.ProcessEnv
  private children: Bun.Subprocess[] = []
  private ports: number[] = []

  constructor(
    env: NodeJS.ProcessEnv,
    private io: SessionIO = defaultIO,
  ) {
    this.env = { ...env }
    // A shell's fixture flags must never change the boundary a suite claims to test.
    for (const flag of ['E2E', 'SMOKE', 'PREVIEW', 'SCREENSHOTS'])
      this.env[`EXPO_PUBLIC_${flag}`] = '0'
    this.env.REACT_NATIVE_PACKAGER_HOSTNAME = '127.0.0.1'
    this.env.EXPO_NO_DOTENV = '1'
    // Local test artifacts are not releases and must not require upload credentials.
    this.env.SENTRY_DISABLE_AUTO_UPLOAD = 'true'
  }

  async port(): Promise<number> {
    // A free host port may still be occupied by a device listener from an unrelated session.
    const mappings = await Promise.all(
      this.io
        .devices()
        .map(async (device) =>
          new TextDecoder().decode(await this.io.adb(device.serial, 'reverse', '--list')),
        ),
    )
    const occupied = new Set(
      mappings.flatMap((listing) => listing.split('\n').map((line) => line.trim().split(/\s+/)[1])),
    )
    for (let attempt = 0; attempt < 100; attempt++) {
      const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
      const port = server.port!
      await server.stop(true)
      if (occupied.has(`tcp:${port}`) || this.ports.includes(port)) continue
      this.ports.push(port)
      return port
    }
    throw new Error('Could not allocate an unused E2E port on the host and devices')
  }

  start(command: string[], log?: string): Bun.Subprocess {
    this.abort.signal.throwIfAborted()
    console.log(`\n> ${command.join(' ')}\n`)
    const fd = log ? openSync(log, 'w') : undefined
    const child = Bun.spawn(command, {
      cwd: ROOT,
      env: this.env,
      stdin: 'inherit',
      stdout: fd ?? 'inherit',
      stderr: fd ?? 'inherit',
      detached: true,
    })
    if (fd !== undefined) closeSync(fd)
    this.children.push(child)
    return child
  }

  async ready(url: string, child: Bun.Subprocess, timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      this.abort.signal.throwIfAborted()
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Server exited before ready: ${url}`)
      // intentional-suppression: connection failures are expected during startup; child exit and the deadline fail the run.
      const ready = await fetch(url, {
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(2000)]),
      })
        .then((response) => response.ok)
        .catch(() => false)
      if (ready) return
      await Bun.sleep(300)
    }
    throw new Error(`Server did not become ready: ${url}`)
  }

  async run(command: string[], timeoutMs = 30 * 60_000): Promise<void> {
    const child = this.start(command)
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeoutMs)])
    let onAbort: () => void = () => {}
    try {
      const code = await Promise.race([
        child.exited,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(signal.reason)
          signal.addEventListener('abort', onAbort, { once: true })
          if (signal.aborted) onAbort()
        }),
      ])
      if (code !== 0) throw new Error(`Command exited ${code}: ${command.join(' ')}`)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  async close(): Promise<void> {
    // Ask nested runners to finish their own finally blocks before removing our listeners.
    for (const child of this.children.slice().reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.warn(error)
      }
      const exited = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(5000).then(() => false),
      ])
      if (!exited) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.warn(error)
        }
        await child.exited
      }
    }
    const results = await Promise.allSettled(
      this.io.devices().map((device) => removeReversePorts(device.serial, this.ports, this.io.adb)),
    )
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'E2E tunnel cleanup failed',
      )
  }
}
