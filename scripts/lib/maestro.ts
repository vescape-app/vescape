import { readFileSync } from 'fs'

export const MAESTRO_VERSION = readFileSync(
  new URL('../../.maestro-version', import.meta.url),
  'utf8',
).trim()

let checked: Promise<void> | undefined

async function checkVersion(): Promise<void> {
  const executable = Bun.which('maestro')
  if (!executable) throw new Error('Maestro is missing. Run bun run maestro:setup.')
  const proc = Bun.spawn([executable, '--version'], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0 || stdout.trim() !== MAESTRO_VERSION) {
    throw new Error(
      `Maestro ${MAESTRO_VERSION} required; found ${stdout.trim() || stderr.trim() || `exit ${code}`}. Run bun run maestro:setup.`,
    )
  }
}

/** Every repository runner checks the same pin once before invoking Maestro. */
export async function maestroCommand(...args: string[]): Promise<string[]> {
  await (checked ??= checkVersion())
  return ['maestro', ...args]
}
