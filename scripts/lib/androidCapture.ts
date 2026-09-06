/**
 * Android side of the store screenshot runner: emulator/device selection, the Release screenshot
 * build, `adb push`ed fixtures and SystemUI demo mode.
 *
 * @parity /scripts/lib/iosCapture.ts
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'

import { applicationId } from '../../src/config/appVariant.ts'
import {
  capture,
  CAPTURE_LOCATION,
  FIXTURE_ZIP,
  runOrDie,
  fixtureBuildEnv,
  warnMissingFixture,
  type CaptureDriver,
  type FixtureRunMode,
} from './captureDriver.ts'
import { listAdbDevices, pickDevice } from './devices.ts'

const OUT_DIR = 'screenshots/android'

/** Mirrors `fixtureDir` in `src/config/fixtureSession.ts`. */
const DEVICE_FIXTURE_DIR = `/storage/emulated/0/Android/data/${applicationId}/files`

/** Play's phone screenshots are cut to this; anything else has to be rescaled by hand. */
const TARGET_RESOLUTION = '1080x2400'

/**
 * `emulator` is not on a plain `PATH` unless the developer put it there, so resolve it from the SDK
 * the way Gradle does. Only the SDK root is consulted — nothing here is machine-specific, and a
 * missing SDK stays the environment's problem to fix, not the script's to paper over.
 */
function emulatorBin(): string {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  const fromSdk = sdk ? join(sdk, 'emulator', 'emulator') : null
  return fromSdk && existsSync(fromSdk) ? fromSdk : 'emulator'
}

/**
 * A device the runner can drive.
 *
 * `serial` addresses it over adb; `name` is what `expo run:android --device` matches on, and the two
 * are not interchangeable — Expo names an emulator by its AVD (`Medium_Phone`, not `emulator-5554`)
 * and a physical device by its `model:` field.
 */
interface Device {
  serial: string
  name: string
  /** What `expo run:android --device` matches; see AdbDevice.expoName. */
  expoName: string
}

async function attachedSerials(): Promise<string[]> {
  const out = await capture(['adb', 'devices'])
  return out
    .split('\n')
    .slice(1)
    .filter((line) => line.includes('\tdevice'))
    .map((line) => line.split('\t')[0].trim())
}

/** Phones only: the store set and the smoke flows are phone UI, and a watch cannot run either. */
function attachedPhones(): Device[] {
  return listAdbDevices()
    .filter((device) => !device.isWatch)
    .map(({ serial, name, expoName }) => ({ serial, name, expoName }))
}

async function listAvds(): Promise<string[]> {
  const out = await capture([emulatorBin(), '-list-avds'])
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** An AVD's screen size, read from its own config — the store set must be one consistent size. */
function avdResolution(name: string): string | null {
  const config = join(homedir(), '.android', 'avd', `${name}.avd`, 'config.ini')
  if (!existsSync(config)) return null
  const text = readFileSync(config, 'utf8')
  const width = /^hw\.lcd\.width=(\d+)$/m.exec(text)?.[1]
  const height = /^hw\.lcd\.height=(\d+)$/m.exec(text)?.[1]
  return width && height ? `${width}x${height}` : null
}

/** Boots an existing AVD and returns it once adb reports it ready. */
async function bootAvd(name: string): Promise<Device> {
  const before = await attachedSerials()
  console.log(`› Booting ${name}…`)
  Bun.spawn([emulatorBin(), '-avd', name, '-no-boot-anim', '-no-snapshot'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })

  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const serial = (await attachedSerials()).find((id) => !before.includes(id))
    if (serial) {
      const booted = (
        await capture(['adb', '-s', serial, 'shell', 'getprop', 'sys.boot_completed'])
      ).trim()
      if (booted === '1') return { serial, name, expoName: name }
    }
    await Bun.sleep(2000)
  }
  console.error(`${name} did not finish booting within 180s.`)
  process.exit(1)
}

/** `adb-54151FDAS00077-x5XeY4._adb-tls-connect._tcp` → `54151FDAS00077`. */
function shortSerial(serial: string): string {
  return serial.replace(/^adb-/, '').replace(/-\w+\._adb-tls-connect\._tcp$/, '')
}

type DeviceChoice = { kind: 'attached'; device: Device } | { kind: 'avd'; name: string }

/** Cache key for the last capture device picked; see lib/lastDevice. */
const LAST_DEVICE_KEY = 'capture-android'

async function chooseDevice(attached: Device[], requested: string | null): Promise<DeviceChoice> {
  const options: DeviceChoice[] = attached.map((device) => ({ kind: 'attached', device }))

  // An AVD that is already up is listed once, as the running device — offering to "boot" it again
  // would be the same device under a second name.
  const running = new Set(attached.map((device) => device.name))
  for (const name of await listAvds()) {
    if (running.has(name)) continue
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
    emptyMessage: 'No phone attached and no AVD available.',
  })
}

async function resolveDevice(requested: string | null, mode: FixtureRunMode): Promise<Device> {
  const choice = await chooseDevice(attachedPhones(), requested)
  const device = choice.kind === 'avd' ? await bootAvd(choice.name) : choice.device
  // Only the store set has to come off one screen size; a smoke run asserts on text, not pixels.
  if (mode === 'screenshots') await warnOnResolution(device.serial)
  return device
}

/** Play cuts phone screenshots to one size; capturing at another means rescaling by hand later. */
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

  return {
    platform: 'android',
    outDir: OUT_DIR,
    deviceId: device.serial,
    deviceLabel: `${device.name} (${device.serial})`,

    async buildAndInstall() {
      console.log(`› Building the Android ${mode} Release build…`)
      await runOrDie(['bun', 'run', 'native:sync', 'android'])
      // Release on both modes. The store set has to be the shipped build, and a smoke run gets a
      // self-contained APK out of it — no Metro server to start and no dev-client launcher screen
      // to tap through before the first flow step.
      // `--device` takes Expo's device name, not the adb serial.
      //
      // `--no-bundler` is what makes this command *return*. Without it Expo installs the APK, opens
      // the dev-client URL and then stays attached streaming logs — on a terminal that reads as a
      // build that finished, but on CI the step simply hangs until the job times out. A release
      // build embeds its bundle, so there is nothing for a bundler to serve either way (the repo's
      // own `android:release` script passes it for the same reason).
      await runOrDie(
        [
          'bunx',
          'expo',
          'run:android',
          '--variant',
          'release',
          '--no-bundler',
          '--device',
          device.expoName,
        ],
        fixtureBuildEnv(mode, replay),
      )
    },

    async requireInstalled() {
      const out = await adb('shell', 'pm', 'list', 'packages', applicationId)
      if (!out.includes(`package:${applicationId}`)) {
        console.error(`${applicationId} is not installed on ${device.name}; drop --no-build.`)
        process.exit(1)
      }
    },

    async stageFixtures() {
      console.log('› Staging fixtures…')
      // `pm clear` wipes the external files dir too, so it has to come before the push.
      await adb('shell', 'pm', 'clear', applicationId)

      if (existsSync(FIXTURE_ZIP)) {
        const remote = `${DEVICE_FIXTURE_DIR}/${basename(FIXTURE_ZIP)}`
        // `pm clear` deleted the external files dir, and `adb push` cannot always recreate it: its
        // `secure_mkdirs` is refused on the FUSE-backed `Android/data` of an emulator image, so the
        // push fails outright with ENOENT. `adb shell mkdir` goes through the sdcard mount as
        // `shell` and is allowed, which is the same explicit `mkdir` the iOS driver does after it
        // wipes the container.
        await adb('shell', 'mkdir', '-p', DEVICE_FIXTURE_DIR)
        // The recreated dir is owned by `shell:ext_data_rw`, mode `rwxrws---`. The app is neither
        // owner nor in that group and cannot traverse its own directory, so `restoreDatabase` fails
        // with EACCES and the run silently captures an empty app. Reopening both levels is what
        // makes the push readable.
        await adb('shell', 'chmod', '777', DEVICE_FIXTURE_DIR, dirname(DEVICE_FIXTURE_DIR))
        // The push does not land on `Android/data` directly: `adb push` chowns what it writes, and
        // FUSE refuses that ("remote fchown failed: Operation not permitted") *after* transferring
        // the bytes, so the push exits non-zero on a file that is actually there. Staging through
        // `/data/local/tmp` (plain ext4, owned by `shell`) keeps the exit code meaningful, and
        // `cp` as `shell` into the reopened dir needs no chown at all.
        const staging = `/data/local/tmp/${basename(FIXTURE_ZIP)}`
        await runOrDie(['adb', '-s', device.serial, 'push', FIXTURE_ZIP, staging])
        await adb('shell', 'cp', staging, remote)
        // `cp` keeps the creating process's umask, so the copy lands unreadable to the app's uid.
        await adb('shell', 'chmod', '666', remote)
        await adb('shell', 'rm', '-f', staging)
        // `capture` discards exit codes, so a rejected copy used to reach the flows as an app with
        // an empty database — the run then failed several steps later on a missing board, pointing
        // at the app rather than at the staging that never happened. Assert the whole file landed.
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

      // Every runtime permission the app asks for, granted up front. Two reasons, both fatal:
      // BLUETOOTH_CONNECT gates the foreground service even for a replay session
      // (`CoreForegroundServiceLauncher`), so without it `startDebugReplay` is skipped and the run
      // captures an app with no telemetry. And any permission left ungranted raises a system dialog
      // over the first screen — it takes window focus, so the pending `startForegroundService()`
      // misses its deadline and the app dies with ForegroundServiceDidNotStartInTimeException.
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
      // KEYCODE_WAKEUP, then ask the window manager to drop the keyguard. A swipe-only lock goes
      // away here; a PIN, pattern or biometric one cannot be dismissed from adb, and should not be.
      await adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
      await adb('shell', 'wm', 'dismiss-keyguard')

      // A system ANR dialog owns the top window, and Maestro only ever sees the top window — so a
      // launcher that stalls on a slow CI emulator makes every element in our app read as absent.
      // Suppressing the dialogs costs nothing: an app that really hangs still fails its assertion,
      // and the debug screenshot still shows what was underneath.
      await adb('shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1')

      const window = await adb('shell', 'dumpsys', 'window')
      if (!/mDreamingLockscreen=true/.test(window)) return

      console.error(
        `${device.name} is locked and its keyguard is secured, so the flows would drive a lock ` +
          'screen. Unlock the device and run again with --no-build.',
      )
      process.exit(1)
    },

    async pinLocation() {
      // `geo fix` is an emulator console command; a physical device would need a mock provider app,
      // which is well past what a screenshot run should install.
      if (!device.serial.startsWith('emulator-')) {
        console.warn('  physical device: location left as-is, the map backdrop will not match iOS')
        return
      }
      const { latitude, longitude } = CAPTURE_LOCATION
      await adb('emu', 'geo', 'fix', String(longitude), String(latitude))
    },

    async setChrome(clean: boolean) {
      // Demo mode exists so panels do not disagree on clock or battery. A smoke run photographs
      // nothing, so it leaves the device's own status bar alone.
      if (mode === 'smoke') return

      // Animation scales are deliberately left alone. Turning them off device-wide makes a frame
      // deterministic by abolishing the thing being photographed, and it outlives the run: a failed
      // flow used to leave every app on the device without animations, with nothing on screen to say
      // why. The flows wait for animations to finish instead — `waitForAnimationToEnd` before each
      // shot, which is the same guarantee scoped to the run.

      // SystemUI demo mode pins the status bar so panels do not disagree on clock or battery.
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
