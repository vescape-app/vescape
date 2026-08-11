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
import { lastFirst, readLastDevice, rememberDevice } from './lib/lastDevice.ts'
import { select, SelectCancelled, type SelectOption } from './lib/select.ts'

interface Target {
  platform: 'android' | 'ios'
  id: string
  name: string
}

async function androidTargets(): Promise<Target[]> {
  const out = await capture(['adb', 'devices', '-l'])
  const lines = out
    .split('\n')
    .slice(1)
    .filter((line) => line.includes(' device ') || line.includes('\tdevice'))
  return lines.map((line) => {
    const id = line.split(/\s+/)[0].trim()
    return { platform: 'android', id, name: /model:(\S+)/.exec(line)?.[1] ?? id }
  })
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
    .map(({ udid, name }) => ({ platform: 'ios' as const, id: udid, name }))
}

/** Cache key for the last device picked; see lib/lastDevice. */
const LAST_DEVICE_KEY = 'screenshot-device'

/** Grace period before the remembered device is taken; any keypress cancels it. */
const AUTO_PICK_MS = 3000

/** `adb-54151FDAS00077-x5XeY4._adb-tls-connect._tcp` → `54151FDAS00077`. */
function shortId(id: string): string {
  return id.replace(/^adb-/, '').replace(/-\w+\._adb-tls-connect\._tcp$/, '')
}

async function resolveTarget(requested: string | null): Promise<Target> {
  const targets = [...(await androidTargets()), ...(await iosTargets())]
  if (targets.length === 0) {
    console.error('No adb device attached and no booted iOS simulator.')
    process.exit(1)
  }

  if (requested) {
    const match = targets.find(
      (target) =>
        target.id === requested || target.name === requested || shortId(target.id) === requested,
    )
    if (!match) {
      console.error(`No device matches "${requested}". Available:`)
      for (const target of targets) console.error(`  ${target.name} (${shortId(target.id)})`)
      process.exit(1)
    }
    return match
  }

  if (targets.length === 1) return targets[0]

  if (!process.stdin.isTTY) {
    console.error('Several devices attached — pass --device <serial|udid|name>:')
    for (const target of targets) {
      console.error(`  ${target.name} (${shortId(target.id)}, ${target.platform})`)
    }
    process.exit(1)
  }

  const last = await readLastDevice(LAST_DEVICE_KEY)
  const ordered = lastFirst(targets, (target) => target.id, last)
  const options: SelectOption<Target>[] = ordered.map((target) => ({
    label: target.name,
    value: target,
    hint: `${target.platform} · ${shortId(target.id)}${target.id === last ? ' · last' : ''}`,
  }))
  return select('Screenshot device', options, { autoPickMs: last ? AUTO_PICK_MS : undefined })
}

async function grab(target: Target, localPath: string): Promise<void> {
  if (target.platform === 'ios') {
    await runOrDie(['xcrun', 'simctl', 'io', target.id, 'screenshot', localPath])
    return
  }
  const remotePath = '/sdcard/screenshot_tmp.png'
  await runOrDie(['adb', '-s', target.id, 'shell', 'screencap', '-p', remotePath])
  await runOrDie(['adb', '-s', target.id, 'pull', remotePath, localPath])
  await runOrDie(['adb', '-s', target.id, 'shell', 'rm', remotePath])
}

const args = process.argv.slice(2)
const deviceFlag = args.findIndex((arg) => arg === '--device' || arg === '-d')
const requested = deviceFlag === -1 ? null : (args[deviceFlag + 1] ?? null)
if (deviceFlag !== -1 && !requested) {
  console.error('--device needs a serial, udid or name')
  process.exit(1)
}

const target = await resolveTarget(requested).catch((error) => {
  if (error instanceof SelectCancelled) process.exit(1)
  throw error
})

await rememberDevice(LAST_DEVICE_KEY, target.id)
console.log(`Device: ${target.name} (${shortId(target.id)})`)

const localPath = join(tmpdir(), `screenshot_${Date.now()}.png`)
await grab(target, localPath)

await runOrDie([
  'osascript',
  '-e',
  `set the clipboard to (read (POSIX file "${localPath}") as «class PNGf»)`,
])

console.log(`Copied to clipboard: ${localPath}`)
