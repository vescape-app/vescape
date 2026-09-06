#!/usr/bin/env bun
/**
 * Ad-hoc "what is on screen right now" screenshot, copied to the clipboard.
 *
 * Unlike `scripts/screenshots.ts` (the store set) this drives nothing and builds nothing: it grabs
 * whatever is on an attached Android device or a booted iOS simulator. With more than one target
 * it asks; agents and other non-TTY callers pass `--device <serial|udid|name>` instead.
 */
import { tmpdir } from 'os'
import { join } from 'path'

import { capture, runOrDie } from './lib/captureDriver.ts'
import { listAdbDevices, pickDevice } from './lib/devices.ts'

interface Target {
  platform: 'android' | 'ios'
  /** What gets remembered and what `--device` matches: a hardware id or a simulator udid. */
  id: string
  name: string
  /** What the capture command addresses: an adb transport id or the same udid. */
  serial: string
  /** Extra `--device` spelling: the adb model token for a device, the name for a simulator. */
  expoName: string
}

/**
 * Every adb device, watches included — grabbing the wrist screen is half of why this exists. The
 * shared listing is what collapses a watch that advertises itself over mDNS twice.
 */
function androidTargets(): Target[] {
  return listAdbDevices().map((device) => ({
    platform: 'android',
    id: device.hardware,
    name: device.name,
    serial: device.serial,
    expoName: device.expoName,
  }))
}

async function iosTargets(): Promise<Target[]> {
  if (process.platform !== 'darwin') return []
  const raw = await capture(['xcrun', 'simctl', 'list', 'devices', 'booted', '-j'])
  if (!raw.trim()) return []
  const parsed = JSON.parse(raw) as {
    devices: Record<string, { udid: string; name: string }[]>
  }
  return Object.values(parsed.devices)
    .flat()
    .map(({ udid, name }) => ({
      platform: 'ios' as const,
      id: udid,
      name,
      serial: udid,
      expoName: name,
    }))
}

/** Cache key for the last device picked; see lib/lastDevice. */
const LAST_DEVICE_KEY = 'screenshot-device'

async function resolveTarget(requested: string | null): Promise<Target> {
  return pickDevice({
    title: 'Screenshot device',
    items: [...androidTargets(), ...(await iosTargets())],
    id: (target) => target.id,
    label: (target) => target.name,
    aliases: (target) => [target.serial, target.expoName],
    hint: (target) => target.platform,
    requested,
    cacheKey: LAST_DEVICE_KEY,
    emptyMessage: 'No adb device attached and no booted iOS simulator.',
  })
}

async function grab(target: Target, localPath: string): Promise<void> {
  if (target.platform === 'ios') {
    await runOrDie(['xcrun', 'simctl', 'io', target.serial, 'screenshot', localPath])
    return
  }
  const remotePath = '/sdcard/screenshot_tmp.png'
  await runOrDie(['adb', '-s', target.serial, 'shell', 'screencap', '-p', remotePath])
  await runOrDie(['adb', '-s', target.serial, 'pull', remotePath, localPath])
  await runOrDie(['adb', '-s', target.serial, 'shell', 'rm', remotePath])
}

const args = process.argv.slice(2)
const deviceFlag = args.findIndex((arg) => arg === '--device' || arg === '-d')
const requested = deviceFlag === -1 ? null : (args[deviceFlag + 1] ?? null)
if (deviceFlag !== -1 && !requested) {
  console.error('--device needs a serial, udid or name')
  process.exit(1)
}

const target = await resolveTarget(requested)
console.log(`Device: ${target.name} (${target.id})`)

const localPath = join(tmpdir(), `screenshot_${Date.now()}.png`)
await grab(target, localPath)

await runOrDie([
  'osascript',
  '-e',
  `set the clipboard to (read (POSIX file "${localPath}") as «class PNGf»)`,
])

console.log(`Copied to clipboard: ${localPath}`)
