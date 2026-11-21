/**
 * @parity /scripts/lib/androidCapture.ts
 */
import { existsSync, mkdirSync, rmSync } from 'fs'
import { basename, join } from 'path'

import { applicationId } from '../../src/config/appVariant.ts'
import {
  capture,
  CAPTURE_LOCATION,
  FIXTURE_ZIP,
  runOrDie,
  warnMissingFixture,
  type CaptureDriver,
  type FixtureRunMode,
} from './captureDriver.ts'
import { pickDevice } from './devices.ts'
import { buildIosFixture } from './fixtureBuild.ts'

const OUT_DIR = 'screenshots/ios'

const PREFERRED_DEVICE = 'iPhone 17 Pro Max'

interface Simulator {
  udid: string
  name: string
  state: string
}

async function simctl(...args: string[]): Promise<string> {
  return capture(['xcrun', 'simctl', ...args])
}

async function listSimulators(): Promise<Simulator[]> {
  const raw = await simctl('list', 'devices', 'available', '-j')
  const parsed = JSON.parse(raw) as {
    devices: Record<string, { udid: string; name: string; state: string }[]>
  }
  return Object.entries(parsed.devices)
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([, devices]) => devices)
    .map(({ udid, name, state }) => ({ udid, name, state }))
}

async function bootSimulator(sim: Simulator): Promise<Simulator> {
  if (sim.state !== 'Booted') {
    console.log(`› Booting ${sim.name}…`)
    await runOrDie(['xcrun', 'simctl', 'boot', sim.udid], undefined, 180_000)
  }
  await runOrDie(['xcrun', 'simctl', 'bootstatus', sim.udid, '-b'], undefined, 600_000)
  await capture(['open', '-a', 'Simulator'])
  return { ...sim, state: 'Booted' }
}

const LAST_SIMULATOR_KEY = 'capture-ios'

async function chooseSimulator(simulators: Simulator[]): Promise<Simulator> {
  const booted = simulators.filter((sim) => sim.state === 'Booted')
  if (booted.length === 1) return booted[0]
  const preferred = simulators.find((sim) => sim.name === PREFERRED_DEVICE)
  if (booted.length === 0 && preferred) return preferred

  return pickDevice({
    title: 'iOS capture simulator',
    items: simulators,
    id: (sim) => sim.udid,
    label: (sim) => sim.name,
    aliases: (sim) => [sim.name],
    hint: (sim) =>
      sim.state === 'Booted' ? 'booted' : sim.name === PREFERRED_DEVICE ? 'store size' : 'boot',
    requested: null,
    cacheKey: LAST_SIMULATOR_KEY,
    emptyMessage: 'No available iOS simulator. Install one from Xcode.',
  })
}

async function resolveSimulator(requested: string | null): Promise<Simulator> {
  const simulators = await listSimulators()
  if (simulators.length === 0) {
    console.error('No available iOS simulator. Install one from Xcode.')
    process.exit(1)
  }

  if (requested) {
    const match = simulators.find((sim) => sim.udid === requested || sim.name === requested)
    if (!match) {
      console.error(`No available simulator matches "${requested}".`)
      process.exit(1)
    }
    return bootSimulator(match)
  }

  const chosen = await bootSimulator(await chooseSimulator(simulators))
  if (chosen.name !== PREFERRED_DEVICE) {
    console.warn(`  ${chosen.name} is not the ${PREFERRED_DEVICE} the store set expects`)
  }
  return chosen
}

async function containerDir(udid: string): Promise<string | null> {
  const path = (await simctl('get_app_container', udid, applicationId, 'data')).trim()
  return path.startsWith('/') && existsSync(path) ? path : null
}

export async function createIosDriver(
  requestedDevice: string | null,
  replay: string,
  mode: FixtureRunMode = 'screenshots',
): Promise<CaptureDriver> {
  const sim = await resolveSimulator(requestedDevice)
  const installArtifact = async (path: string) => {
    console.log(`› Installing ${basename(path)} on ${sim.name}`)
    await runOrDie(['xcrun', 'simctl', 'install', sim.udid, path])
  }

  return {
    platform: 'ios',
    outDir: OUT_DIR,
    deviceId: sim.udid,
    deviceLabel: `${sim.name} (${sim.udid})`,

    async buildAndInstall() {
      await installArtifact(await buildIosFixture(mode, replay))
    },

    installArtifact,

    async requireInstalled() {
      if ((await containerDir(sim.udid)) == null) {
        console.error(`${applicationId} is not installed on ${sim.name}; drop --no-build.`)
        process.exit(1)
      }
    },

    async stageFixtures() {
      console.log('› Staging fixtures…')
      await simctl('terminate', sim.udid, applicationId)

      const container = await containerDir(sim.udid)
      if (container == null) {
        console.error(`${applicationId} is not installed on ${sim.name}.`)
        process.exit(1)
      }

      for (const dir of ['Documents', 'Library/Application Support']) {
        rmSync(join(container, dir), { recursive: true, force: true })
      }
      const documents = join(container, 'Documents')
      mkdirSync(documents, { recursive: true })

      if (existsSync(FIXTURE_ZIP)) {
        await capture(['cp', FIXTURE_ZIP, join(documents, basename(FIXTURE_ZIP))])
      } else {
        warnMissingFixture()
      }

      await simctl('privacy', sim.udid, 'grant', 'location-always', applicationId)
    },

    async requireAwakeDisplay() {},

    async pinLocation() {
      const { latitude, longitude } = CAPTURE_LOCATION
      await simctl('location', sim.udid, 'set', `${latitude},${longitude}`)
    },

    async setChrome(clean: boolean) {
      if (!clean) {
        await simctl('status_bar', sim.udid, 'clear')
        return
      }
      await simctl(
        'status_bar',
        sim.udid,
        'override',
        '--time',
        '9:41',
        '--batteryState',
        'charged',
        '--batteryLevel',
        '100',
        '--cellularBars',
        '4',
        '--wifiBars',
        '3',
      )
    },
  }
}
