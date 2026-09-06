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
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { sdkRoot } from './lib/androidSdk.ts'
import { pickDevice } from './lib/devices.ts'

/** Cache key for the last AVD booted; separate from `android-device`, which spans real phones too. */
const LAST_AVD_KEY = 'android-avd'

const args = process.argv.slice(2)
const deviceFlag = args.findIndex((arg) => arg === '--device' || arg === '-d')
const requested = deviceFlag === -1 ? null : (args[deviceFlag + 1] ?? null)
if (deviceFlag !== -1 && !requested) {
  console.error('--device needs an AVD name')
  process.exit(1)
}

const avdHome = process.env.ANDROID_AVD_HOME ?? join(homedir(), '.android', 'avd')

interface Avd {
  name: string
  /** `avd.ini.displayname` when the AVD has one, otherwise the directory name. */
  label: string
  isWatch: boolean
}

/**
 * AVDs as the `emulator` binary sees them, annotated from each one's `config.ini`: the binary lists
 * names only, and a name says nothing about whether the image is a watch.
 */
function listAvds(binary: string): Avd[] {
  const listed = Bun.spawnSync([binary, '-list-avds'], { env: process.env })
  const names = new TextDecoder()
    .decode(listed.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return names.map((name) => {
    const config = join(avdHome, `${name}.avd`, 'config.ini')
    const ini = existsSync(config) ? readFileSync(config, 'utf8') : ''
    return {
      name,
      label: /^avd\.ini\.displayname=(.+)$/m.exec(ini)?.[1].trim() || name,
      isWatch: /^tag\.id=.*wear/m.test(ini),
    }
  })
}

const binary = join(sdkRoot(), 'emulator', 'emulator')
if (!existsSync(binary)) {
  console.error(`\nno emulator installed at ${binary}`)
  process.exit(1)
}

/**
 * Whether the AVD is already booted. Read from the emulator's own lock rather than `adb devices`,
 * because an emulator that is still booting shows up as `offline` there — and starting a second
 * instance of the same AVD only gets rejected by the lock, detached and silently.
 */
const isRunning = (name: string) =>
  existsSync(join(avdHome, `${name}.avd`, 'hardware-qemu.ini.lock'))

const avd = await pickDevice({
  title: 'Android AVD',
  items: listAvds(binary).filter((it) => !it.isWatch),
  id: (it) => it.name,
  label: (it) => it.label,
  hint: (it) => (isRunning(it.name) ? 'running' : it.name),
  requested,
  cacheKey: LAST_AVD_KEY,
  emptyMessage: `No phone AVD found under ${avdHome}. Create one in Android Studio's device manager.`,
})

if (isRunning(avd.name)) {
  console.log(`android:emulator: ${avd.name} is already running`)
  process.exit(0)
}

// Detached, so the shell that started it is free again — the emulator outlives this process.
console.log(`\n> emulator -avd ${avd.name}\n`)
Bun.spawn([binary, '-avd', avd.name], { stdio: ['ignore', 'ignore', 'ignore'] }).unref()
console.log(`android:emulator: booting ${avd.name}`)
