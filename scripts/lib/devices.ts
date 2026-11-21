import { lastFirst, readLastDevice, rememberDevice } from './lastDevice.ts'
import { select, SelectCancelled, type SelectOption } from './select.ts'

export const AUTO_PICK_MS = 3000

export interface AdbDevice {
  serial: string
  name: string
  expoName: string
  hardware: string
  isWatch: boolean
  isEmulator: boolean
}

export function listAdbDevices(): AdbDevice[] {
  const transports = capture(['adb', 'devices', '-l'])
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const match = /^(.+?)\s+device\b(.*)$/.exec(line)
      if (!match) return []
      return [{ serial: match[1].trim(), model: /model:(\S+)/.exec(match[2])?.[1] ?? '' }]
    })

  const devices = new Map<string, AdbDevice>()
  for (const { serial, model } of transports) {
    const props = capture(['adb', '-s', serial, 'shell', 'getprop'])
    const isEmulator = serial.startsWith('emulator-')
    const hardware = (isEmulator ? '' : prop(props, 'ro.serialno')) || serial
    if (devices.has(hardware)) continue
    const avd = isEmulator
      ? capture(['adb', '-s', serial, 'emu', 'avd', 'name']).split('\n')[0].trim()
      : ''
    devices.set(hardware, {
      serial,
      name: avd || prop(props, 'ro.product.model') || hardware,
      expoName: avd || model || prop(props, 'ro.product.model') || serial,
      hardware,
      isWatch: prop(props, 'ro.build.characteristics').includes('watch'),
      isEmulator,
    })
  }
  return [...devices.values()]
}

function prop(props: string, key: string): string {
  return props.match(new RegExp(`^\\[${key}\\]: \\[(.*)\\]$`, 'm'))?.[1] ?? ''
}

function capture(command: string[]): string {
  const result = Bun.spawnSync(command, { env: process.env })
  return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : ''
}

export interface PickDeviceArgs<T> {
  title: string
  items: T[]
  id: (item: T) => string
  label: (item: T) => string
  aliases?: (item: T) => string[]
  hint?: (item: T) => string
  requested: string | null
  cacheKey: string | null
  emptyMessage: string
}

export async function pickDevice<T>({
  title,
  items,
  id,
  label,
  aliases,
  hint,
  requested,
  cacheKey,
  emptyMessage,
}: PickDeviceArgs<T>): Promise<T> {
  const describe = () => items.map((item) => `${label(item)} (${id(item)})`).join(', ')

  if (items.length === 0) die(emptyMessage)

  if (requested) {
    const match = items.find(
      (item) =>
        id(item) === requested ||
        label(item) === requested ||
        (aliases?.(item) ?? []).includes(requested),
    )
    if (!match) die(`no device matches "${requested}" — connected: ${describe()}`)
    return match
  }

  if (items.length === 1) return items[0]

  if (!process.stdin.isTTY) {
    die(`several devices to choose from — pass --device <name|serial>: ${describe()}`)
  }

  const last = cacheKey ? await readLastDevice(cacheKey) : null
  const ordered = lastFirst(items, id, last)
  const options: SelectOption<T>[] = ordered.map((item) => ({
    label: label(item),
    value: item,
    hint:
      [hint?.(item), id(item) === last ? 'last' : null].filter(Boolean).join(' · ') || undefined,
  }))

  const autoPick = last !== null && id(ordered[0]) === last
  const chosen = await select(title, options, {
    autoPickMs: autoPick ? AUTO_PICK_MS : undefined,
  }).catch((error) => {
    if (error instanceof SelectCancelled) process.exit(1)
    throw error
  })

  if (cacheKey) await rememberDevice(cacheKey, id(chosen))
  return chosen
}

function die(message: string): never {
  console.error(`\n${message}`)
  process.exit(1)
}
