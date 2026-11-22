import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { sdkRoot } from './androidSdk.ts'
import { pickDevice } from './devices.ts'

export const PHONE_AVD_KEY = 'android-avd'
export const WATCH_AVD_KEY = 'wear-avd'

export interface Avd {
  name: string
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

export function isAvdRunning(name: string): boolean {
  let owner: string
  try {
    owner = readFileSync(join(avdHome(), `${name}.avd`, 'hardware-qemu.ini.lock'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }

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

export function bootAvd(name: string) {
  console.log(`\n> emulator -avd ${name}\n`)
  Bun.spawn([emulatorBinary(), '-avd', name], { stdio: ['ignore', 'ignore', 'ignore'] }).unref()
}

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
