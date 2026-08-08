#!/usr/bin/env bun
/**
 * Store screenshot capture harness.
 *
 * Drives the real app — Release build, `EXPO_PUBLIC_SCREENSHOTS=1`, `EXPO_PUBLIC_E2E` unset — through
 * `e2e/flows/screenshots/*.yaml` and collects one PNG per panel, per platform. Data comes from two
 * existing mechanisms and no new native code: a database backup zip restored on startup (history,
 * boards, tunes, alerts) and a Debug Recording replayed at 1x through the real telemetry pipeline.
 *
 *   bun run screenshots                        # asks for platform, then device
 *   bun run screenshots --platform ios         # iOS only, on a Release simulator build
 *   bun run screenshots --panel 4 --no-build   # one panel against the installed build
 *   bun run screenshots --device R5CT          # skip the picker and target this serial/udid
 *
 * The flow files are shared: `OUT_DIR` is the only thing that differs between the two runs, so the
 * panel list, their order and their filenames stay identical and the sets can be compared side by
 * side. Everything platform-specific lives behind `CaptureDriver` (`scripts/lib/captureDriver.ts`).
 *
 * The hero panel is captured last, on purpose. `TelemetryPipeline.liveSeries` buckets the sparkline
 * over `liveHistoryLimit` minutes of *receipt* timestamps, so filling it takes that much session
 * time. Replay warmup provides the opening stretch up front — session time runs faster than real
 * time, so the samples are stamped across the window they actually span instead of being squeezed
 * into the seconds it took to deliver them — and the run only waits out whatever is left beyond
 * that. The replay recording must be at least as long as the whole run.
 */
import { mkdirSync, readdirSync } from 'fs'
import { basename, join } from 'path'

import { applicationId } from '../src/config/appVariant.ts'
import { REPLAY_WARMUP_MS, REPLAY_WARMUP_WALL_MS } from '../src/config/replayWarmup.ts'
import { createAndroidDriver } from './lib/androidCapture.ts'
import {
  CommandFailed,
  ROOT,
  runOrDie,
  type CaptureDriver,
  type CapturePlatform,
} from './lib/captureDriver.ts'
import { createIosDriver } from './lib/iosCapture.ts'
import { select, SelectCancelled } from './lib/select.ts'

const FLOWS_DIR = join(ROOT, 'e2e', 'flows', 'screenshots')
/** Shared with the smoke run — see `e2e/flows/fixture/_boot.yaml`. */
const BOOT_FLOW = join('..', 'fixture', '_boot.yaml')

const PLATFORMS: CapturePlatform[] = ['android', 'ios']

/** 13-minute city ride: long enough to outlast a whole capture run at 1x. */
const DEFAULT_REPLAY = 'replay-thor301.jsonl'
/** `AppSettings.liveHistoryLimit` default — the sparkline window the hero panel has to fill. */
const DEFAULT_SPARKLINE_MINUTES = 5

interface Args {
  /** `null` until the picker runs — `--platform` skips it. */
  platforms: CapturePlatform[] | null
  panel: number | null
  device: string | null
  replay: string
  sparklineMinutes: number
  noBuild: boolean
  noWait: boolean
}

function parsePlatform(value: string): CapturePlatform[] {
  if (value === 'both') return PLATFORMS
  if (value === 'android' || value === 'ios') return [value]
  throw new Error(`Unknown platform "${value}"; expected android, ios or both`)
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    platforms: null,
    panel: null,
    device: null,
    replay: DEFAULT_REPLAY,
    sparklineMinutes: DEFAULT_SPARKLINE_MINUTES,
    noBuild: false,
    noWait: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (value == null) throw new Error(`Missing value for ${arg}`)
      i += 1
      return value
    }
    if (arg === '--platform') args.platforms = parsePlatform(next())
    else if (arg === '--panel') args.panel = Number(next())
    else if (arg === '--device') args.device = next()
    else if (arg === '--replay') args.replay = next()
    else if (arg === '--sparkline-minutes') args.sparklineMinutes = Number(next())
    else if (arg === '--no-build') args.noBuild = true
    else if (arg === '--no-wait') args.noWait = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (args.panel != null && !Number.isInteger(args.panel))
    throw new Error('--panel must be an integer')
  // `--device` names one device, so it cannot address two platforms at once.
  if (args.device) {
    if (args.platforms == null) throw new Error('--device needs an explicit --platform')
    if (args.platforms.length > 1) throw new Error('--device needs a single --platform')
  }
  return args
}

/**
 * Platform first, device second — the two runs are sequential and a whole Android pass (build, 8
 * panels, the sparkline wait) sits in front of the iOS one, so "both" has to be a deliberate choice
 * rather than what you get for pressing Enter on a device list.
 */
async function resolvePlatforms(args: Args): Promise<CapturePlatform[]> {
  if (args.platforms) return args.platforms
  return select('Capture platform', [
    { label: 'Android', value: ['android'] as CapturePlatform[], hint: 'Play, 1080x2400' },
    { label: 'iOS', value: ['ios'] as CapturePlatform[], hint: 'App Store, 1320x2868' },
    { label: 'Both', value: PLATFORMS, hint: 'Android first, then iOS' },
  ])
}

// ── capture ──────────────────────────────────────────────────────────────────

/** Panel flows, sorted: `NN-name.yaml`. Helpers start with `_`. */
function panelFlows(): string[] {
  return readdirSync(FLOWS_DIR)
    .filter((file) => file.endsWith('.yaml') && !file.startsWith('_'))
    .sort()
}

function selectPanels(panel: number | null): string[] {
  const flows = panelFlows()
  if (panel == null) return flows
  const prefix = String(panel).padStart(2, '0')
  const match = flows.find((file) => file.startsWith(`${prefix}-`))
  if (!match) {
    console.error(
      `Unknown panel ${panel}. Available: ${flows.map((f) => f.slice(0, 2)).join(', ')}`,
    )
    process.exit(1)
  }
  return [match]
}

async function runFlow(file: string, driver: CaptureDriver): Promise<void> {
  console.log(`› ${basename(file, '.yaml')}`)
  // Without --device Maestro picks the first attached device itself, which silently drives whatever
  // else is plugged in rather than the one this run prepared.
  await runOrDie([
    'maestro',
    'test',
    '--device',
    driver.deviceId,
    '-e',
    `APP_ID=${applicationId}`,
    '-e',
    `OUT_DIR=${driver.outDir}`,
    join(FLOWS_DIR, file),
  ])
}

async function createDriver(platform: CapturePlatform, args: Args): Promise<CaptureDriver> {
  return platform === 'ios'
    ? createIosDriver(args.device, args.replay)
    : createAndroidDriver(args.device, args.replay)
}

async function capturePlatform(platform: CapturePlatform, args: Args): Promise<void> {
  const driver = await createDriver(platform, args)
  const outDir = join(ROOT, driver.outDir)
  mkdirSync(outDir, { recursive: true })

  console.log(`\n[${platform}] ${driver.deviceLabel}`)

  // Build by default: an installed package only proves *something* is installed, not that it is a
  // screenshot build, and reusing the wrong one produces a run that goes nowhere.
  if (args.noBuild) {
    await driver.requireInstalled()
    console.log('› Reusing the installed build (--no-build) — it must be a screenshot build.')
  } else {
    await driver.buildAndInstall()
  }

  await driver.requireAwakeDisplay()
  await driver.stageFixtures()
  await driver.pinLocation()
  await driver.setChrome(true)

  try {
    const selected = selectPanels(args.panel)
    // The hero shot needs a full sparkline window, so it always goes last; everything else is shot
    // while the replay is still filling it.
    const hero = selected.filter((file) => file.startsWith('01-'))
    const rest = selected.filter((file) => !file.startsWith('01-'))

    const bootedAt = Date.now()
    await runFlow(BOOT_FLOW, driver)
    for (const file of rest) await runFlow(file, driver)

    if (hero.length > 0 && !args.noWait) {
      // The warmup hands over its window already filled, but delivering it costs real seconds of
      // its own — the run has to wait out the rest of the window *plus* that.
      const toFillMs =
        Math.max(0, args.sparklineMinutes * 60_000 - REPLAY_WARMUP_MS) + REPLAY_WARMUP_WALL_MS
      const remainingMs = toFillMs - (Date.now() - bootedAt)
      if (remainingMs > 0) {
        console.log(`› Waiting ${Math.ceil(remainingMs / 1000)}s for the sparkline window to fill…`)
        await Bun.sleep(remainingMs)
      }
    }
    for (const file of hero) await runFlow(file, driver)
  } finally {
    await driver.setChrome(false)
  }

  console.log(`\nScreenshots → ${outDir}`)
  for (const file of readdirSync(outDir)
    .filter((f) => f.endsWith('.png'))
    .sort()) {
    console.log(`  ${file}`)
  }
}

async function main(args: Args): Promise<void> {
  const platforms = await resolvePlatforms(args)
  // Sequentially: both runs drive Maestro and a 1x replay, and the sparkline wait is wall clock, so
  // there is nothing to gain from interleaving them and a lot of device contention to lose.
  for (const platform of platforms) await capturePlatform(platform, args)
}

let args: Args
try {
  args = parseArgs(Bun.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

try {
  await main(args)
} catch (error) {
  if (error instanceof SelectCancelled) process.exit(130)
  // Reported, not rethrown: the device restore has already run in `capturePlatform`'s `finally`,
  // and a stack trace for a failed Maestro flow adds nothing to what Maestro already printed.
  if (error instanceof CommandFailed) {
    console.error(error.message)
    process.exit(error.code)
  }
  throw error
}
