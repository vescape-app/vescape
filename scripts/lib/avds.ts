/**
 * Android Virtual Devices as the SDK's `emulator` binary sees them, for every CLI that boots one
 * (`android:emulator`, `wear:emulator`, `android:up`).
 */
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { sdkRoot } from './androidSdk.ts'
import { pickDevice } from './devices.ts'

/**
 * Cache keys for the last AVD picked on each side (see lib/lastDevice); separate from the adb-device
 * keys, which span real phones and watches too.
 */
export const PHONE_AVD_KEY = 'android-avd'
export const WATCH_AVD_KEY = 'wear-avd'

export interface Avd {
  name: string
  /** `avd.ini.displayname` when the AVD has one, otherwise the directory name. */
  label: string
  isWatch: boolean
}

export function avdHome(): string {
  return process.env.ANDROID_AVD_HOME ?? join(homedir(), '.android', 'avd')
}

export function emulatorBinary(): string {
  const binary = join(sdkRoot(), 'emulator', 'emulator')
  if (!existsSync(binary)) {
    console.error(`\nno emulator installed at ${binary}`)
    process.exit(1)
  }
  return binary
}

/**
 * AVDs as the `emulator` binary sees them, annotated from each one's `config.ini`: the binary lists
 * names only, and a name says nothing about whether the image is a watch.
 */
export function listAvds(): Avd[] {
  const listed = Bun.spawnSync([emulatorBinary(), '-list-avds'], { env: process.env })
  const names = new TextDecoder()
    .decode(listed.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return names.map((name) => {
    const config = join(avdHome(), `${name}.avd`, 'config.ini')
    const ini = existsSync(config) ? readFileSync(config, 'utf8') : ''
    return {
      name,
      label: /^avd\.ini\.displayname=(.+)$/m.exec(ini)?.[1].trim() || name,
      isWatch: /^tag\.id=.*wear/m.test(ini),
    }
  })
}

/**
 * Check the lock's owner, not just the file: crashes can leave stale locks behind. A live owner
 * also covers emulators still booting, before they become available through adb. Let the emulator
 * reclaim stale locks itself rather than deleting a lock that another launch might have acquired.
 */
export function isAvdRunning(name: string): boolean {
  let owner: string
  try {
    owner = readFileSync(join(avdHome(), `${name}.avd`, 'hardware-qemu.ini.lock'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }

  // The emulator writes an ASCII PID with a trailing NUL. Reject invalid PIDs so signal 0
  // cannot accidentally query our own process group or all processes.
  const pid = Number(owner.replace(/\0$/, '').trim())
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    throw error
  }
}

/** Boots an AVD detached, so the shell that started it is free again; it outlives this process. */
export function bootAvd(name: string) {
  console.log(`\n> emulator -avd ${name}\n`)
  Bun.spawn([emulatorBinary(), '-avd', name], { stdio: ['ignore', 'ignore', 'ignore'] }).unref()
}

/**
 * The phone or watch AVD a wear flow should run on. An explicit name always wins; otherwise one
 * already running of that kind is taken over booting another, and only a cold machine is asked.
 */
export function pickAvd(watch: boolean, requested: string | null): Promise<Avd> {
  const items = listAvds().filter((it) => it.isWatch === watch)
  const running = items.filter((it) => isAvdRunning(it.name))
  return pickDevice({
    title: watch ? 'Wear AVD' : 'Phone AVD',
    items: requested || running.length === 0 ? items : running,
    id: (it) => it.name,
    label: (it) => it.label,
    hint: (it) => (isAvdRunning(it.name) ? 'running' : it.name),
    requested,
    cacheKey: watch ? WATCH_AVD_KEY : PHONE_AVD_KEY,
    emptyMessage: `No ${watch ? 'Wear' : 'phone'} AVD found under ${avdHome()}. Create one in Android Studio's device manager.`,
  })
}
