import { existsSync } from 'fs'
import { basename, join } from 'path'

export type CapturePlatform = 'android' | 'ios'

export type FixtureRunMode = 'screenshots' | 'smoke' | 'preview'

export const ROOT = join(import.meta.dir, '..', '..')
export const FIXTURE_ZIP = join(ROOT, 'shared', 'fixtures', 'screenshot-db.zip')

export const CAPTURE_LOCATION = { latitude: 51.1079, longitude: 17.0385 }

export interface CaptureDriver {
  readonly platform: CapturePlatform
  readonly outDir: string
  readonly deviceId: string
  readonly deviceLabel: string
  buildAndInstall(): Promise<void>
  installArtifact(path: string): Promise<void>
  requireInstalled(): Promise<void>
  stageFixtures(): Promise<void>
  pinLocation(): Promise<void>
  requireAwakeDisplay(): Promise<void>
  setChrome(clean: boolean): Promise<void>
}

export async function capture(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out
}

export class CommandFailed extends Error {
  constructor(
    readonly code: number,
    cmd: string[],
  ) {
    super(`Command failed (${code}): ${cmd.join(' ')}`)
  }
}

export async function runOrDie(
  cmd: string[],
  env?: Record<string, string | undefined>,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
    ...(timeoutMs ? { timeout: timeoutMs, killSignal: 'SIGKILL' } : {}),
    ...(env ? { env } : {}),
    ...(signal ? { signal } : {}),
  })
  const code = (await proc.exited) ?? 1
  if (code !== 0) throw new CommandFailed(code, cmd)
}

export function fixtureBuildEnv(
  mode: FixtureRunMode,
  replay: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    EXPO_PUBLIC_FIXTURE_REPLAY: replay,
    EXPO_PUBLIC_FIXTURE_DB: existsSync(FIXTURE_ZIP) ? basename(FIXTURE_ZIP) : '',
  }
  delete env.EXPO_PUBLIC_E2E
  delete env.EXPO_PUBLIC_SCREENSHOTS
  delete env.EXPO_PUBLIC_SMOKE
  delete env.EXPO_PUBLIC_PREVIEW
  if (mode === 'screenshots') env.EXPO_PUBLIC_SCREENSHOTS = '1'
  else if (mode === 'preview') env.EXPO_PUBLIC_PREVIEW = '1'
  else env.EXPO_PUBLIC_SMOKE = '1'
  return env
}

export function warnMissingFixture(): void {
  console.warn(`  no ${FIXTURE_ZIP} — capturing with replay telemetry only, history will be empty`)
}
