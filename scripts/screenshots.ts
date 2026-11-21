#!/usr/bin/env bun
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'

import { applicationId } from '../src/config/appVariant.ts'
import { maestroCommand } from './lib/maestro.ts'
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
const BOOT_FLOW = join('..', 'fixture', '_boot.yaml')

const PLATFORMS: CapturePlatform[] = ['android', 'ios']

const DEFAULT_REPLAY = 'replay-thor301.jsonl'

interface Args {
  platforms: CapturePlatform[] | null
  panel: number | null
  device: string | null
  replay: string
  noBuild: boolean
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
    noBuild: false,
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
    else if (arg === '--no-build') args.noBuild = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (args.panel != null && !Number.isInteger(args.panel))
    throw new Error('--panel must be an integer')
  if (args.device) {
    if (args.platforms == null) throw new Error('--device needs an explicit --platform')
    if (args.platforms.length > 1) throw new Error('--device needs a single --platform')
  }
  return args
}

async function resolvePlatforms(args: Args): Promise<CapturePlatform[]> {
  if (args.platforms) return args.platforms
  return select('Capture platform', [
    { label: 'Android', value: ['android'] as CapturePlatform[], hint: 'Play, 1080x2400' },
    { label: 'iOS', value: ['ios'] as CapturePlatform[], hint: 'App Store, 1320x2868' },
    { label: 'Both', value: PLATFORMS, hint: 'Android first, then iOS' },
  ])
}

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

const FLOW_OUT_DIR = 'shots'

async function runFlow(file: string, driver: CaptureDriver): Promise<void> {
  console.log(`› ${basename(file, '.yaml')}`)
  const testOutputDir = mkdtempSync(join(tmpdir(), 'vescape-shots-'))
  try {
    await runOrDie(
      await maestroCommand(
        'test',
        '--device',
        driver.deviceId,
        '--test-output-dir',
        testOutputDir,
        '-e',
        `APP_ID=${applicationId}`,
        '-e',
        `OUT_DIR=${FLOW_OUT_DIR}`,
        join(FLOWS_DIR, file),
      ),
    )
    collectScreenshots(testOutputDir, join(ROOT, driver.outDir))
  } finally {
    rmSync(testOutputDir, { recursive: true, force: true })
  }
}

function collectScreenshots(testOutputDir: string, outDir: string): void {
  for (const entry of readdirSync(testOutputDir, { recursive: true, encoding: 'utf8' })) {
    const parts = entry.split(/[\\/]/)
    if (!entry.endsWith('.png') || parts.at(-2) !== FLOW_OUT_DIR) continue
    if (parts.at(-3) !== 'takeScreenshot') continue
    copyFileSync(join(testOutputDir, entry), join(outDir, parts.at(-1)!))
  }
}

async function createDriver(platform: CapturePlatform, args: Args): Promise<CaptureDriver> {
  return platform === 'ios'
    ? createIosDriver(args.device, args.replay)
    : createAndroidDriver(args.device, args.replay)
}

async function capturePlatform(driver: CaptureDriver, args: Args): Promise<void> {
  const outDir = join(ROOT, driver.outDir)
  mkdirSync(outDir, { recursive: true })

  console.log(`\n[${driver.platform}] ${driver.deviceLabel}`)

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
    await runFlow(BOOT_FLOW, driver)
    for (const file of selectPanels(args.panel)) await runFlow(file, driver)
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
  const drivers: CaptureDriver[] = []
  for (const platform of platforms) drivers.push(await createDriver(platform, args))
  for (const driver of drivers) await capturePlatform(driver, args)
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
  if (error instanceof CommandFailed) {
    console.error(error.message)
    process.exit(error.code)
  }
  throw error
}
