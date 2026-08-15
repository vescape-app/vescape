/**
 * Platform contract for the store screenshot runner (`scripts/screenshots.ts`).
 *
 * The runner owns everything platform-agnostic — panel selection, flow order, the sparkline wait —
 * and a driver owns the parts that are genuinely different: how a device is picked and booted, how
 * a Release screenshot build is produced, how the fixture zip reaches the app, and how the status
 * bar is pinned. Both drivers drive the *same* flow files; a panel that needs different steps per
 * platform belongs in a sub-flow, not in a second flow set.
 */
import { existsSync } from 'fs'
import { basename, join } from 'path'

export type CapturePlatform = 'android' | 'ios'

/**
 * Which harness a fixture build serves. Both boot from the same staged database and replayed
 * recording; they differ in what they do with the session and therefore in how much of the device
 * they are entitled to pin down.
 */
export type FixtureRunMode = 'screenshots' | 'smoke'

export const ROOT = join(import.meta.dir, '..', '..')
export const FIXTURE_ZIP = join(ROOT, 'shared', 'fixtures', 'screenshot-db.zip')

/**
 * Where the capture run pretends to be: Wrocław old town.
 *
 * Replay owns position once it starts — the recording's GPS fixes replay alongside its chunks — but
 * the device still decides where the map sits until the first replayed fix lands. Left alone, iOS
 * boots on the simulator default (San Francisco) and the emulator on its own, and the two store sets
 * stop being comparable.
 */
export const CAPTURE_LOCATION = { latitude: 51.1079, longitude: 17.0385 }

export interface CaptureDriver {
  readonly platform: CapturePlatform
  /** Repo-relative output dir, handed to the flows as `OUT_DIR` for `takeScreenshot`. */
  readonly outDir: string
  /** What Maestro's `--device` takes: an adb serial or a simulator udid. */
  readonly deviceId: string
  /** Human label for the run header. */
  readonly deviceLabel: string
  /** Builds the Release `EXPO_PUBLIC_SCREENSHOTS=1` app and installs it on the resolved device. */
  buildAndInstall(): Promise<void>
  /** Fails the run when `--no-build` was passed and nothing is installed to reuse. */
  requireInstalled(): Promise<void>
  /** Clears app data and stages the fixture zip where the app's bootstrap reads it. */
  stageFixtures(): Promise<void>
  /** Pins the device to `CAPTURE_LOCATION` so both sets share one map backdrop. */
  pinLocation(): Promise<void>
  /**
   * Makes sure the flows will drive the app and not a lock screen.
   *
   * A physical Android device locks itself while a Release build compiles, and a locked one fails
   * every flow at its first assertion with nothing on screen to say why — the app is running and
   * focused underneath, so the failure reads as a broken app rather than a covered one.
   */
  requireAwakeDisplay(): Promise<void>
  /** Pins (`clean`) or restores the status bar and any other run chrome. */
  setChrome(clean: boolean): Promise<void>
}

// ── process helpers ──────────────────────────────────────────────────────────

export async function capture(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out
}

/**
 * Run a command, throwing on a non-zero exit.
 *
 * It throws rather than calling `process.exit`, which does not unwind: a capture run mutates the
 * device (animation scales off, SystemUI demo mode on) and restores it in a `finally`, and an exit
 * from inside the try skips that. A failing Maestro flow used to leave the device with every
 * animation globally disabled — a static spinner and a map that teleports, on every app built
 * afterwards, with nothing on screen to say why.
 */
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
): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
    ...(env ? { env } : {}),
  })
  const code = (await proc.exited) ?? 1
  if (code !== 0) throw new CommandFailed(code, cmd)
}

/**
 * Build env for a run that boots from staged fixtures, identical on both platforms and both modes.
 *
 * Every mode flag is cleared before the chosen one is set, because the ambient environment gets
 * spread in first. `EXPO_PUBLIC_E2E` would reroute board and telemetry reads to `e2eFake`, leaving
 * the native replay session invisible to the UI — the screenshots would photograph a fake and the
 * smoke run would assert against one. The *other* run's flag is no better: a shell that already
 * exports `EXPO_PUBLIC_SCREENSHOTS=1` would give a smoke build both modes at once, and
 * `showDevControls` (capture-only) would then hide the REPLAY badge that `01-telemetry` asserts on.
 *
 * Fixture names are baked into the build rather than read from a file at runtime — see
 * `src/config/fixtureSession.ts`.
 */
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
  if (mode === 'screenshots') env.EXPO_PUBLIC_SCREENSHOTS = '1'
  else env.EXPO_PUBLIC_SMOKE = '1'
  return env
}

export function warnMissingFixture(): void {
  console.warn(`  no ${FIXTURE_ZIP} — capturing with replay telemetry only, history will be empty`)
}
