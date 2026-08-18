#!/usr/bin/env bun
/**
 * `bun run android` — the dev-client build and install, with the repo's device picker in front of
 * Expo's.
 *
 * Expo's own prompt lists every attached device, watch included, and a watch is never the answer
 * here: the phone app does not run on Wear, and picking one wastes a full Gradle install before it
 * fails. The picker also behaves like every other device prompt in the repo (last pick on top,
 * taken after 3s, `--device` to skip it), which Expo's does not.
 *
 *   bun run android                  # pick, or take the only phone
 *   bun run android --device Pixel_7 # skip the picker
 *   bun run android --variant release --no-bundler   # anything else goes to expo run:android
 */
import { listAdbDevices, pickDevice } from './lib/devices.ts'

const args = process.argv.slice(2)

const deviceFlag = args.findIndex((arg) => arg === '--device' || arg === '-d')
const requested = deviceFlag === -1 ? null : (args[deviceFlag + 1] ?? null)
if (deviceFlag !== -1) {
  if (!requested) {
    console.error('--device needs a name or serial')
    process.exit(1)
  }
  args.splice(deviceFlag, 2)
}

/** Cache key for the last phone picked; shared with the wear pairing flow. */
const LAST_PHONE_KEY = 'android-device'

const phone = await pickDevice({
  title: 'Android device',
  items: listAdbDevices().filter((device) => !device.isWatch),
  id: (device) => device.hardware,
  label: (device) => device.name,
  aliases: (device) => [device.serial, device.expoName],
  hint: (device) => (device.isEmulator ? 'emulator' : device.serial),
  requested,
  cacheKey: LAST_PHONE_KEY,
  emptyMessage:
    'No Android phone attached (`adb devices` shows none). Start an emulator or plug one in.',
})

function run(command: string[]) {
  console.log(`\n> ${command.join(' ')}\n`)
  const result = Bun.spawnSync(command, {
    env: process.env,
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  })
  if (!result.success) process.exit(result.exitCode ?? 1)
}

run(['bun', 'run', 'native:sync', 'android'])
run(['bun', 'run', 'relay:reverse'])
// `--device` takes Expo's device name (the AVD for an emulator, the model for a physical device),
// which is exactly what listAdbDevices reports as `name`.
run(['bunx', 'expo', 'run:android', '--device', phone.expoName, ...args])
