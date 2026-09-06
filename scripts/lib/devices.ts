/**
 * One device picker for every CLI in the repo.
 *
 * Before this, each script asked "which device?" its own way: some prompted, some took the first
 * match, some remembered the last pick and some did not — so the same two phones and one watch on
 * the desk behaved differently depending on which command you typed. [pickDevice] is the single
 * answer: an explicit `--device` always wins, a lone candidate is taken silently, and anything else
 * is an arrow-key list with the last pick on top, auto-taken after a short countdown.
 *
 * Listing and filtering stay with the callers — only adb devices are shared here ([listAdbDevices]),
 * since simulators and AVDs are platform-specific and already have homes.
 */
import { lastFirst, readLastDevice, rememberDevice } from './lastDevice.ts'
import { select, SelectCancelled, type SelectOption } from './select.ts'

/** Grace period before the remembered device is taken; any keypress cancels it. */
export const AUTO_PICK_MS = 3000

export interface AdbDevice {
  /** Transport id `adb -s` takes. */
  serial: string
  /**
   * The human-facing name, and what `expo run:android --device` matches on: an emulator is known by
   * its AVD (`WearLarge`, not `emulator-5554`), everything else by `ro.product.model`.
   */
  name: string
  /**
   * What `expo run:android --device` matches: the underscored `model:` token from `adb devices -l`
   * for a physical device, the AVD name for an emulator. Not the same string as [name] — Expo reads
   * the adb model token (`Pixel_9_Pro_XL`), never `ro.product.model` (`Pixel 9 Pro XL`).
   */
  expoName: string
  /** Hardware id, so the same device reached over two transports collapses to one entry. */
  hardware: string
  isWatch: boolean
  isEmulator: boolean
}

/**
 * Attached adb devices, classified by what they say they are rather than by their transport id: a
 * watch reports `ro.build.characteristics=watch` whether it is a real OnePlus or a Wear AVD. Devices
 * reached twice (the OnePlus Watch 3 advertises itself over mDNS more than once) collapse by
 * `ro.serialno`, so a duplicate transport is never a choice the user has to make.
 */
export function listAdbDevices(): AdbDevice[] {
  // Split on the state word, not on whitespace: an mDNS transport id can itself contain a space
  // (`adb-H63…-NIEs41 (2)._adb-tls-connect._tcp`), and cutting it short addresses nothing.
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
    // Emulators all report the same `ro.serialno` (`EMULATOR…`), so two running AVDs would collapse
    // into one entry — their console port is what actually tells them apart.
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

/** One `[key]: [value]` line out of `adb shell getprop` output. */
function prop(props: string, key: string): string {
  return props.match(new RegExp(`^\\[${key}\\]: \\[(.*)\\]$`, 'm'))?.[1] ?? ''
}

function capture(command: string[]): string {
  const result = Bun.spawnSync(command, { env: process.env })
  return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : ''
}

export interface PickDeviceArgs<T> {
  /** Prompt title, e.g. `Wear device`. */
  title: string
  /** What the caller has already listed and filtered down to what this command can drive. */
  items: T[]
  /** Stable id: what `--device` matches, what gets remembered, what the hint shows. */
  id: (item: T) => string
  label: (item: T) => string
  /** Extra `--device` spellings, e.g. an adb serial next to the model name. */
  aliases?: (item: T) => string[]
  hint?: (item: T) => string
  /** `--device` value, or null to choose interactively. */
  requested: string | null
  /** Cache file name for the last pick, or null to never remember (see lib/lastDevice). */
  cacheKey: string | null
  /** Shown when nothing survived the caller's filter, e.g. `no Wear OS device connected`. */
  emptyMessage: string
}

/**
 * Resolves one device. Exits the process on an unmatched `--device`, an empty list, or several
 * candidates with no TTY to ask on — every one of those is a dead end for the caller, and the error
 * lists what was actually connected so the next invocation can name one.
 */
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

  // Only count down onto a device that was actually picked before: with no match the first row is
  // an arbitrary device, and running a build against it unasked is worse than waiting.
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
