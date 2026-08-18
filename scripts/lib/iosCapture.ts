/**
 * iOS side of the store screenshot runner: simulator selection and boot, the Release screenshot
 * build, fixtures copied straight into the simulator container and `simctl status_bar`.
 *
 * No physical device: `simctl status_bar` has no device equivalent, and a pinned clock/battery is
 * what makes the panels a coherent store set.
 *
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
  fixtureBuildEnv,
  warnMissingFixture,
  type CaptureDriver,
} from './captureDriver.ts'
import { pickDevice } from './devices.ts'

const OUT_DIR = 'screenshots/ios'

/**
 * The 6.9" size App Store Connect requires (1320x2868). Apple downscales it to the smaller phone
 * sizes, so the store set needs this one simulator and no other.
 */
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
  if (sim.state === 'Booted') return sim
  console.log(`› Booting ${sim.name}…`)
  await simctl('boot', sim.udid)
  // Maestro drives the simulator through its UI, so the Simulator app has to be on screen.
  await capture(['open', '-a', 'Simulator'])

  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const current = (await listSimulators()).find((device) => device.udid === sim.udid)
    if (current?.state === 'Booted') return current
    await Bun.sleep(2000)
  }
  console.error(`${sim.name} did not finish booting within 180s.`)
  process.exit(1)
}

/** Cache key for the last capture simulator picked; see lib/lastDevice. */
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

/** The simulator's container is a host directory, so the fixture zip is a plain file copy. */
async function containerDir(udid: string): Promise<string | null> {
  const path = (await simctl('get_app_container', udid, applicationId, 'data')).trim()
  return path.startsWith('/') && existsSync(path) ? path : null
}

export async function createIosDriver(
  requestedDevice: string | null,
  replay: string,
): Promise<CaptureDriver> {
  const sim = await resolveSimulator(requestedDevice)

  return {
    platform: 'ios',
    outDir: OUT_DIR,
    deviceId: sim.udid,
    deviceLabel: `${sim.name} (${sim.udid})`,

    async buildAndInstall() {
      console.log('› Building the iOS screenshot Release build…')
      await runOrDie(['bun', 'run', 'native:sync', 'ios'])
      // A Release build with the flags baked in: no Metro, no dev-client launcher, so the app the
      // flows drive is the app the store gets.
      await runOrDie(
        ['bunx', 'expo', 'run:ios', '--configuration', 'Release', '--device', sim.udid],
        fixtureBuildEnv('screenshots', replay),
      )
    },

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

      // There is no `pm clear` here: wiping the two dirs the app writes to (the GRDB database lives
      // in Application Support, the fixture zip in Documents) is the same fresh start.
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

    async requireAwakeDisplay() {
      // A simulator has no keyguard: nothing can come between the flows and the app.
    },

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
