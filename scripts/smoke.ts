#!/usr/bin/env bun
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join, relative, resolve } from 'path'

import { applicationId } from '../src/config/appVariant.ts'
import { runSmokeMaestro } from './lib/smokeMaestro.ts'
import { maestroCommand } from './lib/maestro.ts'
import { createAndroidDriver } from './lib/androidCapture.ts'
import {
  CommandFailed,
  ROOT,
  type CaptureDriver,
  type CapturePlatform,
} from './lib/captureDriver.ts'
import { createIosDriver } from './lib/iosCapture.ts'
import { buildAndroidFixture, buildIosFixture } from './lib/fixtureBuild.ts'

const FLOWS_DIR = join(ROOT, 'e2e', 'flows', 'smoke')
const BOOT_FLOW = join(ROOT, 'e2e', 'flows', 'fixture', '_boot.yaml')

export const DEFAULT_REPLAY = 'replay-thor301-1hz.jsonl'

export interface Args {
  platform: CapturePlatform
  device: string | null
  flow: string | null
  build: boolean
  replay: string
  app: string | null
  buildOnly: boolean
  output: string | null
  listFlows: boolean
}

function parsePlatform(value: string): CapturePlatform {
  if (value === 'android' || value === 'ios') return value
  throw new Error(`Unknown platform "${value}"; expected android or ios`)
}

export function readArgs(argv: string[]): Args {
  const args: Args = {
    platform: 'android',
    device: null,
    flow: null,
    build: true,
    replay: DEFAULT_REPLAY,
    app: null,
    buildOnly: false,
    output: null,
    listFlows: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (!value) throw new Error(`Missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === '--platform') args.platform = parsePlatform(next())
    else if (arg === '--device') args.device = next()
    else if (arg === '--flow') args.flow = next()
    else if (arg === '--replay') args.replay = next()
    else if (arg === '--no-build') args.build = false
    else if (arg === '--app') args.app = resolve(next())
    else if (arg === '--build-only') args.buildOnly = true
    else if (arg === '--output') args.output = resolve(next())
    else if (arg === '--list-flows') args.listFlows = true
    else throw new Error(`Unknown argument: ${arg}`)
  }

  if (args.buildOnly && (!args.output || args.app || !args.build || args.listFlows)) {
    throw new Error('--build-only requires --output and cannot reuse an installed app or artifact.')
  }
  if (args.output && !args.buildOnly) throw new Error('--output requires --build-only.')
  return args
}

export function selectFlows(only: string | null): string[] {
  const all = readdirSync(FLOWS_DIR)
    .filter((file) => file.endsWith('.yaml') && !file.startsWith('_'))
    .sort()

  if (!only) return all

  const match = all.find((file) => file === only || file === `${only}.yaml`)
  if (!match) {
    throw new Error(`No smoke flow named "${only}". Available:\n  ${all.join('\n  ')}`)
  }
  return [match]
}

async function runFlow(path: string, driver: CaptureDriver): Promise<void> {
  console.log(`› ${basename(path, '.yaml')}`)
  await runSmokeMaestro(
    await maestroCommand(
      'test',
      '--device',
      driver.deviceId,
      '-e',
      `APP_ID=${applicationId}`,
      path,
    ),
    path,
  )
}

async function launchAndroidApp(deviceId: string): Promise<void> {
  console.log('› Launching the prepared Android app…')
  const command = [
    'adb',
    '-s',
    deviceId,
    'shell',
    'am',
    'start',
    '-W',
    '-n',
    `${applicationId}/.MainActivity`,
  ]
  const process = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'inherit',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  })
  const output = await new Response(process.stdout).text()
  const code = await process.exited
  console.log(output.trim())
  if (code !== 0) throw new CommandFailed(code, command)
  if (!/^Status: ok\s*$/m.test(output))
    throw new Error('Android activity did not start successfully.')
}

interface SmokeDependencies {
  checkMaestro: () => Promise<unknown>
  buildApp: (args: Args) => Promise<string>
  createDriver: (args: Args) => Promise<CaptureDriver>
  runFlow: typeof runFlow
  launchAndroidApp: typeof launchAndroidApp
}

const dependencies: SmokeDependencies = {
  checkMaestro: () => maestroCommand(),
  buildApp: (args) =>
    args.platform === 'ios'
      ? buildIosFixture('smoke', args.replay)
      : buildAndroidFixture('smoke', args.replay),
  createDriver: (args) =>
    args.platform === 'ios'
      ? createIosDriver(args.device, args.replay, 'smoke')
      : createAndroidDriver(args.device, args.replay, 'smoke'),
  runFlow,
  launchAndroidApp,
}

export async function main(args: Args, deps: SmokeDependencies = dependencies): Promise<void> {
  const flows = selectFlows(args.flow)
  if (args.listFlows) {
    console.log(JSON.stringify(flows))
    return
  }
  if (args.buildOnly) {
    const artifact = await deps.buildApp(args)
    const output = args.output!
    mkdirSync(dirname(output), { recursive: true })
    cpSync(artifact, output, { recursive: true, verbatimSymlinks: true })
    console.log(`› Build artifact: ${output}`)
    return
  }

  await deps.checkMaestro()
  const driver = await deps.createDriver(args)

  console.log(`\nSmoke · ${driver.deviceLabel}`)
  console.log(`  flows: ${flows.join(', ')}`)

  if (args.app) await driver.installArtifact(args.app)
  else if (args.build) await driver.buildAndInstall()
  else await driver.requireInstalled()

  await driver.requireAwakeDisplay()
  await driver.stageFixtures()
  await driver.pinLocation()
  if (args.platform === 'android') await deps.launchAndroidApp(driver.deviceId)

  const sessionDir = mkdtempSync(join(tmpdir(), 'vescape-smoke-'))
  const sessionFlow = join(sessionDir, 'smoke.yaml')
  try {
    const paths = [BOOT_FLOW, ...flows.map((flow) => join(FLOWS_DIR, flow))]
    await Bun.write(
      sessionFlow,
      [
        `appId: ${JSON.stringify(applicationId)}`,
        ...(args.platform === 'android' ? ['env:', '  APP_ALREADY_LAUNCHED: "true"'] : []),
        '---',
        JSON.stringify(paths.map((path) => ({ runFlow: relative(sessionDir, path) }))),
        '',
      ].join('\n'),
    )
    await deps.runFlow(sessionFlow, driver)
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
  }

  console.log('\nSmoke passed.')
}

if (import.meta.main) {
  try {
    await main(readArgs(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof CommandFailed) {
      console.error(`\n${error.message}`)
      process.exit(error.code)
    }
    throw error
  }
}
