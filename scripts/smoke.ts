#!/usr/bin/env bun
/**
 * Smoke run: walk the screens a rider actually opens, against the real native stack.
 *
 * It boots the same way the store screenshot run does — a Release build, a restored fixture
 * database, a Debug Recording replayed through the telemetry pipeline (`scripts/screenshots.ts`,
 * ADR 0024) — and then asserts instead of photographing. That shared boot is the point:
 * `EXPO_PUBLIC_E2E` reroutes board and telemetry reads to `e2eFake`, so the existing E2E suite
 * cannot catch a native regression at all. This run can, because nothing between the recorded BLE
 * chunks and the rendered gauge is faked.
 *
 *   bun run smoke                      # picks a device, builds, runs every flow
 *   bun run smoke --no-build           # reuse the smoke build already installed
 *   bun run smoke --flow 03-history    # one flow, against the installed build
 *   bun run smoke --device R5CT        # skip the picker
 *
 * Android only, like the E2E suite it sits beside: the flows are driven over adb, and iOS has no
 * equivalent path that does not go through a simulator build. The screenshot run covers iOS because
 * the store requires it to.
 */
import { readdirSync } from 'fs'
import { basename, join } from 'path'

import { applicationId } from '../src/config/appVariant.ts'
import { createAndroidDriver } from './lib/androidCapture.ts'
import { CommandFailed, ROOT, runOrDie, type CaptureDriver } from './lib/captureDriver.ts'

const FLOWS_DIR = join(ROOT, 'e2e', 'flows', 'smoke')
const BOOT_FLOW = join(ROOT, 'e2e', 'flows', 'fixture', '_boot.yaml')

/** Same city ride the capture run replays; long enough to outlast the whole smoke pass at 1x. */
const DEFAULT_REPLAY = 'replay-thor301.jsonl'

interface Args {
  device: string | null
  flow: string | null
  build: boolean
  replay: string
}

function readArgs(argv: string[]): Args {
  const args: Args = { device: null, flow: null, build: true, replay: DEFAULT_REPLAY }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (!value) throw new Error(`Missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === '--device') args.device = next()
    else if (arg === '--flow') args.flow = next()
    else if (arg === '--replay') args.replay = next()
    else if (arg === '--no-build') args.build = false
    else throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

/**
 * Flows run in filename order, and the order is load-bearing: `04-add-board` saves a board, which
 * sends the connection manager at real BLE hardware that is not there and takes the replay session
 * down with it. Anything needing live telemetry has to have run already.
 */
function selectFlows(only: string | null): string[] {
  const all = readdirSync(FLOWS_DIR)
    .filter((file) => file.endsWith('.yaml') && !file.startsWith('_'))
    .sort()

  if (!only) return all

  const match = all.find((file) => file === only || file === `${only}.yaml`)
  if (!match) {
    console.error(`No smoke flow named "${only}". Available:\n  ${all.join('\n  ')}`)
    process.exit(1)
  }
  return [match]
}

async function runFlow(path: string, driver: CaptureDriver): Promise<void> {
  console.log(`› ${basename(path, '.yaml')}`)
  // Without --device Maestro picks the first attached device itself, which silently drives whatever
  // else is plugged in rather than the one this run prepared.
  await runOrDie([
    'maestro',
    'test',
    '--device',
    driver.deviceId,
    '-e',
    `APP_ID=${applicationId}`,
    path,
  ])
}

async function main(args: Args): Promise<void> {
  const driver = await createAndroidDriver(args.device, args.replay, 'smoke')
  const flows = selectFlows(args.flow)

  console.log(`\nSmoke · ${driver.deviceLabel}`)
  console.log(`  flows: ${flows.join(', ')}`)

  if (args.build) await driver.buildAndInstall()
  else await driver.requireInstalled()

  await driver.requireAwakeDisplay()
  await driver.stageFixtures()
  await driver.pinLocation()

  await runFlow(BOOT_FLOW, driver)
  for (const flow of flows) await runFlow(join(FLOWS_DIR, flow), driver)

  console.log('\nSmoke passed.')
}

const args = readArgs(process.argv.slice(2))
try {
  await main(args)
} catch (error) {
  if (error instanceof CommandFailed) {
    console.error(`\n${error.message}`)
    process.exit(error.code)
  }
  throw error
}
