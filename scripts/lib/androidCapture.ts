/**
 * @parity /scripts/lib/iosCapture.ts
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'

import { applicationId } from '../../src/config/appVariant.ts'
import { avdHome, emulatorBinary, listAvds } from './avds.ts'
import {
  capture,
  CAPTURE_LOCATION,
  FIXTURE_ZIP,
  runOrDie,
  warnMissingFixture,
  type CaptureDriver,
  type FixtureRunMode,
} from './captureDriver.ts'
import { listAdbDevices, pickDevice, type AdbDevice } from './devices.ts'
import { buildAndroidFixture } from './fixtureBuild.ts'

const OUT_DIR = 'screenshots/android'

const DEVICE_FIXTURE_DIR = `/storage/emulated/0/Android/data/${applicationId}/files`

const TARGET_RESOLUTION = '1080x2400'

function avdResolution(name: string): string | null {
  const config = join(avdHome(), `${name}.avd`, 'config.ini')
  if (!existsSync(config)) return null
  const text = readFileSync(config, 'utf8')
  const width = /^hw\.lcd\.width=(\d+)$/m.exec(text)?.[1]
  const height = /^hw\.lcd\.height=(\d+)$/m.exec(text)?.[1]
  return width && height ? `${width}x${height}` : null
}

async function bootAvd(name: string): Promise<AdbDevice> {
  console.log(`› Booting ${name}…`)
  Bun.spawn([emulatorBinary(), '-avd', name, '-no-boot-anim', '-no-snapshot'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })

  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const device = listAdbDevices().find((it) => it.isEmulator && it.name === name)
    if (device) {
      const booted = (
        await capture(['adb', '-s', device.serial, 'shell', 'getprop', 'sys.boot_completed'])
      ).trim()
      if (booted === '1') {
        if (device.isWatch)
          throw new Error(`${name} is a Wear emulator. Select a phone for capture.`)
        return device
      }
    }
    await Bun.sleep(2000)
  }
  console.error(`${name} did not finish booting within 180s.`)
  process.exit(1)
}

function shortSerial(serial: string): string {
  return serial.replace(/^adb-/, '').replace(/-\w+\._adb-tls-connect\._tcp$/, '')
}

type DeviceChoice = { kind: 'attached'; device: AdbDevice } | { kind: 'avd'; name: string }

const LAST_DEVICE_KEY = 'capture-android'

async function chooseDevice(requested: string | null): Promise<DeviceChoice> {
  const attached = listAdbDevices()
  const options: DeviceChoice[] = attached
    .filter((device) => !device.isWatch)
    .map((device) => ({ kind: 'attached', device }))

  const running = new Set(
    attached.filter((device) => device.isEmulator).map((device) => device.name),
  )
  for (const { name, isWatch } of listAvds()) {
    if (isWatch || running.has(name)) continue
    options.push({ kind: 'avd', name })
  }

  return pickDevice({
    title: 'Android capture device',
    items: options,
    id: (choice) => (choice.kind === 'avd' ? choice.name : choice.device.name),
    label: (choice) => (choice.kind === 'avd' ? `boot ${choice.name}` : choice.device.name),
    aliases: (choice) =>
      choice.kind === 'avd' ? [] : [choice.device.serial, choice.device.expoName],
    hint: (choice) =>
      choice.kind === 'avd'
        ? (avdResolution(choice.name) ?? 'AVD')
        : shortSerial(choice.device.serial),
    requested,
    cacheKey: LAST_DEVICE_KEY,
    emptyMessage: 'No phone attached and no phone AVD available.',
  })
}

async function resolveDevice(requested: string | null, mode: FixtureRunMode): Promise<AdbDevice> {
  const choice = await chooseDevice(requested)
  const device = choice.kind === 'avd' ? await bootAvd(choice.name) : choice.device
  if (mode === 'screenshots') await warnOnResolution(device.serial)
  return device
}

async function warnOnResolution(device: string): Promise<void> {
  const size = /(\d+x\d+)/.exec(await capture(['adb', '-s', device, 'shell', 'wm', 'size']))?.[1]
  if (size && size !== TARGET_RESOLUTION) {
    console.warn(`  device is ${size}, not the ${TARGET_RESOLUTION} the store set expects`)
  }
}

export async function createAndroidDriver(
  requestedDevice: string | null,
  replay: string,
  mode: FixtureRunMode = 'screenshots',
): Promise<CaptureDriver> {
  const device = await resolveDevice(requestedDevice, mode)
  const adb = (...rest: string[]) => capture(['adb', '-s', device.serial, ...rest])
  const installArtifact = (path: string) =>
    runOrDie(['adb', '-s', device.serial, 'install', '-r', path])

  return {
    platform: 'android',
    outDir: OUT_DIR,
    deviceId: device.serial,
    deviceLabel: `${device.name} (${device.serial})`,

    async buildAndInstall() {
      const architecture = (await adb('shell', 'getprop', 'ro.product.cpu.abi')).trim()
      const app = await buildAndroidFixture(mode, replay, architecture)
      await installArtifact(app)
    },

    installArtifact,

    async requireInstalled() {
      const out = await adb('shell', 'pm', 'list', 'packages', applicationId)
      if (!out.includes(`package:${applicationId}`)) {
        console.error(`${applicationId} is not installed on ${device.name}; drop --no-build.`)
        process.exit(1)
      }
    },

    async stageFixtures() {
      console.log('› Staging fixtures…')
      await adb('shell', 'pm', 'clear', applicationId)

      if (existsSync(FIXTURE_ZIP)) {
        const remote = `${DEVICE_FIXTURE_DIR}/${basename(FIXTURE_ZIP)}`
        await adb('shell', 'mkdir', '-p', DEVICE_FIXTURE_DIR)
        await adb('shell', 'chmod', '777', DEVICE_FIXTURE_DIR, dirname(DEVICE_FIXTURE_DIR))
        const staging = `/data/local/tmp/${basename(FIXTURE_ZIP)}`
        await runOrDie(['adb', '-s', device.serial, 'push', FIXTURE_ZIP, staging])
        await adb('shell', 'cp', staging, remote)
        await adb('shell', 'chmod', '666', remote)
        await adb('shell', 'rm', '-f', staging)
        const expected = statSync(FIXTURE_ZIP).size
        const staged = (await adb('shell', 'stat', '-c', '%s', remote)).trim()
        if (staged !== String(expected)) {
          console.error(
            `Fixture zip did not land on ${device.name} at ${remote}: ` +
              `expected ${expected} bytes, got "${staged}".`,
          )
          process.exit(1)
        }
      } else {
        warnMissingFixture()
      }

      for (const permission of [
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'BLUETOOTH_CONNECT',
        'BLUETOOTH_SCAN',
        'ACTIVITY_RECOGNITION',
        'POST_NOTIFICATIONS',
      ]) {
        await adb('shell', 'pm', 'grant', applicationId, `android.permission.${permission}`)
      }
    },

    async requireAwakeDisplay() {
      await adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
      await adb('shell', 'wm', 'dismiss-keyguard')

      const window = await adb('shell', 'dumpsys', 'window')
      if (!/mDreamingLockscreen=true/.test(window)) return

      console.error(
        `${device.name} is locked and its keyguard is secured, so the flows would drive a lock ` +
          'screen. Unlock the device and run again with --no-build.',
      )
      process.exit(1)
    },

    async pinLocation() {
      if (!device.serial.startsWith('emulator-')) {
        console.warn('  physical device: location left as-is, the map backdrop will not match iOS')
        return
      }
      const { latitude, longitude } = CAPTURE_LOCATION
      await adb('emu', 'geo', 'fix', String(longitude), String(latitude))
    },

    async setChrome(clean: boolean) {
      if (mode === 'smoke') return

      await adb('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', clean ? '1' : '0')
      const demo = (...args: string[]) =>
        adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', ...args)
      if (!clean) {
        await demo('command', 'exit')
        return
      }
      await demo('command', 'enter')
      await demo('command', 'clock', '-e', 'hhmm', '0941')
      await demo('command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false')
      await demo('command', 'network', '-e', 'wifi', 'show', '-e', 'level', '4')
      await demo(
        'command',
        'network',
        '-e',
        'mobile',
        'show',
        '-e',
        'level',
        '4',
        '-e',
        'datatype',
        'none',
      )
      await demo('command', 'notifications', '-e', 'visible', 'false')
    },
  }
}
