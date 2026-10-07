#!/usr/bin/env bun
/**
 * `bun run android:emulator` — boot a phone AVD, using the repo's device picker.
 *
 * The phone flow assumed a device was already attached (`bun run android` fails with "start an
 * emulator or plug one in"), which meant leaving the terminal for Studio's device manager. Watch
 * AVDs are filtered out for the same reason `bun run android` filters watches: the phone app does
 * not run on Wear.
 *
 *   bun run android:emulator                       # pick, or take the only phone AVD
 *   bun run android:emulator --device Medium_Phone # skip the picker
 */
import { avdHome, bootAvd, isAvdRunning, listAvds, PHONE_AVD_KEY } from './lib/avds.ts'
import { pickDevice } from './lib/devices.ts'

const args = process.argv.slice(2)
const deviceFlag = args.findIndex((arg) => arg === '--device' || arg === '-d')
const requested = deviceFlag === -1 ? null : (args[deviceFlag + 1] ?? null)
if (deviceFlag !== -1 && !requested) {
  console.error('--device needs an AVD name')
  process.exit(1)
}

const avd = await pickDevice({
  title: 'Android AVD',
  items: listAvds().filter((it) => !it.isWatch),
  id: (it) => it.name,
  label: (it) => it.label,
  hint: (it) => (isAvdRunning(it.name) ? 'running' : it.name),
  requested,
  cacheKey: PHONE_AVD_KEY,
  emptyMessage: `No phone AVD found under ${avdHome()}. Create one in Android Studio's device manager.`,
})

if (isAvdRunning(avd.name)) {
  console.log(`android:emulator: ${avd.name} is already running`)
  process.exit(0)
}

bootAvd(avd.name)
console.log(`android:emulator: booting ${avd.name}`)
