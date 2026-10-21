import { existsSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { sdkRoot } from './lib/androidSdk.ts'
import { bootAvd, isAvdRunning, pickAvd, type Avd } from './lib/avds.ts'
import { listAdbDevices, pickDevice, type AdbDevice } from './lib/devices.ts'
import { devClientUrl, METRO_URL, watchRideUrl } from './lib/devLinks.ts'

const ROOT = join(import.meta.dir, '..')
/**
 * The activity class comes from the module's Kotlin namespace, which withWearMirror leaves alone;
 * only the applicationId follows the Expo profile, so the component has to be fully qualified.
 */
const ACTIVITY_CLASS = 'app.vescape.wear.MainActivity'
const WEAR_GRADLE = join(ROOT, 'android', 'wearos', 'build.gradle')
const DEBUG_APK = join(
  ROOT,
  'android',
  'wearos',
  'build',
  'outputs',
  'apk',
  'debug',
  'wearos-debug.apk',
)

/**
 * The Wear Mirror and the phone app share an applicationId, and the Wear Data Layer only talks
 * between apps signed with the same certificate. Gradle signs the watch APK with its own debug key,
 * so it has to be re-signed with the phone's before install or the watch silently rejects every
 * frame with `WearableService: Mismatched certificate`.
 */
const PHONE_KEYSTORE = join(ROOT, 'android', 'app', 'debug.keystore')
const SIGNED_APK = join(tmpdir(), 'wearos-debug-phone-cert-signed.apk')

const COMMANDS = ['build', 'test', 'install', 'emulator', 'replay', 'pair', 'up', 'ride'] as const
type Command = (typeof COMMANDS)[number]

/** Wear AVD for `emulator` and `up`; unset, the AVD picker chooses (a running one first). */
const WEAR_AVD = process.env.WEAR_AVD ?? null

/** Lane fixtures the emulator build replays, keyed by the `replay` intent extra MainActivity reads. */
const REPLAY_FIXTURES = ['ride', 'sweep'] as const

/** The step `up` is on, so a failure names where the machine got stuck. */
let step: string | null = null

function begin(name: string) {
  step = name
  console.log(`\nwear: — ${name}`)
}

function fail(message: string): never {
  console.error(`\nwear: ${step ? `${step} failed: ` : ''}${message}`)
  process.exit(1)
}

/** Default cap for one adb command; builds pass their own. Nothing in the wear flow waits forever. */
const COMMAND_TIMEOUT_MS = 120_000
/** Prebuild or a cold Gradle build of the whole Android project. */
const BUILD_TIMEOUT_MS = 30 * 60_000

function run(
  command: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
) {
  console.log(`\n> ${command.join(' ')}\n`)

  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS
  const result = Bun.spawnSync(command, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
    timeout: timeoutMs,
  })

  if (result.exitedDueToTimeout) fail(`${command[0]} timed out after ${timeoutMs / 1000} s`)
  // `exitCode` is null when the child dies from a signal, so report the signal rather than "null".
  if (!result.success) {
    fail(`${command[0]} exited with ${result.exitCode ?? `signal ${result.signalCode}`}`)
  }
}

function capture(command: string[]) {
  const result = Bun.spawnSync(command, { cwd: ROOT, env: process.env, timeout: 30_000 })
  return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : ''
}

/** Polls [probe] until it returns a value; `null` once [timeoutMs] passes. */
async function waitFor<T>(timeoutMs: number, probe: () => T | null | Promise<T | null>) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== null) return value
    await Bun.sleep(1000)
  }
  return null
}

/** Polls a device's log for a line from [tag] matching any of [patterns]; `null` on timeout. */
function waitForLog(serial: string, tag: string, patterns: RegExp[], timeoutMs: number) {
  return waitFor(
    timeoutMs,
    () =>
      capture(['adb', '-s', serial, 'logcat', '-d', '-s', `${tag}:*`])
        .split('\n')
        .filter((it) => it.includes(` ${tag}: `))
        .find((it) => patterns.some((pattern) => pattern.test(it))) ?? null,
  )
}

function gradle(task: string) {
  // The generated Android project's Expo/RN Gradle plugins shell out to node during configuration,
  // and a non-interactive shell often has no node on PATH — same dance as the `test:android` script.
  const node = Bun.which('node')
  if (!node) fail('node not found on PATH')

  run(['./gradlew', task], {
    cwd: join(ROOT, 'android'),
    env: { NODE_BINARY: node, PATH: `${dirname(node)}:${process.env.PATH}` },
    timeoutMs: BUILD_TIMEOUT_MS,
  })
}

/** `android/wearos/` is generated from `watch/wearos/` by the withWearMirror plugin during prebuild. */
function syncNative() {
  run(['bun', 'run', 'scripts/native-sync.ts', 'android'], { timeoutMs: BUILD_TIMEOUT_MS })
}

/**
 * withWearMirror stamps the watch module with the phone's applicationId, which carries the Expo
 * profile suffix — a dev prebuild installs `app.vescape.dev` alongside the store `app.vescape`.
 * Read it back from the generated module so install, launch and smoke check all target the app this
 * run just built instead of whichever build happens to own the unsuffixed id.
 */
function applicationId() {
  if (!existsSync(WEAR_GRADLE)) fail(`missing ${WEAR_GRADLE} — run \`bun run android\` once`)

  const applicationId = readFileSync(WEAR_GRADLE, 'utf8').match(
    /applicationId\s+['"]([^'"]+)['"]/,
  )?.[1]
  if (!applicationId) fail(`applicationId missing from ${WEAR_GRADLE}`)

  return applicationId
}

function buildTools() {
  const sdk = sdkRoot()

  const dir = join(sdk, 'build-tools')
  if (!existsSync(dir)) fail(`no build-tools installed under ${dir}`)

  const latest = readdirSync(dir).sort(Bun.semver.order).at(-1)
  if (!latest) fail(`no build-tools installed under ${dir}`)

  return join(dir, latest)
}

function signWithPhoneCert() {
  if (!existsSync(DEBUG_APK)) fail(`missing ${DEBUG_APK}`)
  if (!existsSync(PHONE_KEYSTORE)) fail(`missing ${PHONE_KEYSTORE} — run \`bun run android\` once`)

  const tools = buildTools()
  const aligned = join(tmpdir(), 'wearos-debug-aligned.apk')

  run([join(tools, 'zipalign'), '-f', '-p', '4', DEBUG_APK, aligned])
  run([
    join(tools, 'apksigner'),
    'sign',
    '--ks',
    PHONE_KEYSTORE,
    '--ks-key-alias',
    'androiddebugkey',
    '--ks-pass',
    'pass:android',
    '--key-pass',
    'pass:android',
    '--out',
    SIGNED_APK,
    aligned,
  ])
}

/** Cache keys for the last pick on each side of the pairing; see lib/lastDevice. */
const LAST_WATCH_KEY = 'wear-device'
const LAST_PHONE_KEY = 'android-device'

const watches = () => listAdbDevices().filter((device) => device.isWatch)

function findWatch(requested: string | null): Promise<AdbDevice> {
  return pickDevice({
    title: 'Wear device',
    items: watches(),
    id: (watch) => watch.hardware,
    label: (watch) => watch.name,
    aliases: (watch) => [watch.serial, watch.expoName],
    requested,
    cacheKey: LAST_WATCH_KEY,
    emptyMessage: 'wear: no Wear OS device connected (`adb devices` shows none)',
  })
}

/** The phone side of a pairing: any connected non-watch device. */
function findPhone(requested: string | null): Promise<AdbDevice> {
  return pickDevice({
    title: 'Phone',
    items: listAdbDevices().filter((device) => !device.isWatch),
    id: (phone) => phone.hardware,
    label: (phone) => phone.name,
    aliases: (phone) => [phone.serial, phone.expoName],
    requested,
    cacheKey: LAST_PHONE_KEY,
    emptyMessage: 'wear: no phone connected (`adb devices` shows none)',
  })
}

function install(serial: string, packageName: string) {
  const result = Bun.spawnSync(['adb', '-s', serial, 'install', '-r', SIGNED_APK], {
    cwd: ROOT,
    env: process.env,
    timeout: COMMAND_TIMEOUT_MS,
  })
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)
  console.log(`\n> adb -s ${serial} install -r ${SIGNED_APK}\n`)
  console.log(output.trim())

  if (result.exitCode === 0) return

  // A cert or signature change cannot be applied over an existing install; this is the one case the
  // wear flow is allowed to uninstall, because the data it holds is a mirror of the phone's.
  if (!output.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE')) {
    fail(`install failed with ${result.exitCode}`)
  }

  console.log('\nwear: incompatible existing install, reinstalling')
  run(['adb', '-s', serial, 'uninstall', packageName])
  run(['adb', '-s', serial, 'install', SIGNED_APK])
}

/**
 * Re-signing is deterministic, so an installed APK with the signed APK's hash is this exact build
 * and the install, which restarts nothing useful and costs seconds, can be skipped.
 */
function isInstalled(serial: string, packageName: string) {
  const path = capture(['adb', '-s', serial, 'shell', 'pm', 'path', packageName])
    .split('\n')
    .find((line) => line.endsWith('/base.apk'))
    ?.replace('package:', '')
  if (!path) return false
  const hash = new Bun.CryptoHasher('sha256').update(readFileSync(SIGNED_APK)).digest('hex')
  return capture(['adb', '-s', serial, 'shell', 'sha256sum', path]).startsWith(hash)
}

function launch(serial: string, packageName: string) {
  // Already-granted (or not-yet-requestable) is not a failure worth aborting the launch for.
  capture([
    'adb',
    '-s',
    serial,
    'shell',
    'pm',
    'grant',
    packageName,
    'android.permission.POST_NOTIFICATIONS',
  ])

  // The crash buffer is persistent, so anything already in it predates this install and would make
  // the smoke check fail on a healthy app. Clear it here and everything it holds afterwards is ours;
  // the main buffer too, so the first-frame line `up` waits for comes from this launch.
  run(['adb', '-s', serial, 'logcat', '-b', 'main', '-b', 'crash', '-c'])
  // `-S`: a running Mirror logs its first frame once per process, so only a fresh one proves frames.
  run([
    'adb',
    '-s',
    serial,
    'shell',
    'am',
    'start',
    '-S',
    '-W',
    '-n',
    `${packageName}/${ACTIVITY_CLASS}`,
  ])
}

function smokeCheck(serial: string) {
  // `am start -W` returns once the activity is up, which is before a crash during first frame or
  // Data Layer setup would land in the buffer.
  Bun.sleepSync(3000)

  const crashes = capture(['adb', '-s', serial, 'logcat', '-b', 'crash', '-d'])
    .split('\n')
    .filter((line) => line.trim().length > 0)

  if (crashes.length > 0) {
    console.error('\nwear: fresh crash in the watch log:\n')
    console.error(crashes.slice(-20).join('\n'))
    process.exit(1)
  }

  console.log('\nwear: installed, launched, no crash in the watch log')
}

/**
 * Boots the Wear AVD detached, so the shell that started it is free again. A normal emulator launch
 * mirrors its paired phone; fixture playback is entered explicitly through `wear:replay`.
 */
async function startEmulator() {
  const avd = await pickAvd(true, WEAR_AVD)
  if (isAvdRunning(avd.name)) {
    console.log(`wear: ${avd.name} is already running`)
    return
  }
  bootAvd(avd.name)
  console.log(`wear: booting ${avd.name} (override with WEAR_AVD)`)
}

/** Cold boot of a phone and a Wear AVD side by side, up to `sys.boot_completed` on both. */
const BOOT_TIMEOUT_MS = 300_000

/**
 * Boots whichever of the two AVDs is not running yet, together, and returns both once Android has
 * finished booting on each. An AVD reaches adb well before its system is up, so adb alone is not
 * "booted".
 */
async function bootEmulators(requestedPhone: string | null) {
  const avds = [await pickAvd(false, requestedPhone), await pickAvd(true, WEAR_AVD)]
  for (const avd of avds.filter((it) => !isAvdRunning(it.name))) bootAvd(avd.name)

  const booted = (avd: Avd) =>
    listAdbDevices().find(
      (device) =>
        device.name === avd.name &&
        capture(['adb', '-s', device.serial, 'shell', 'getprop', 'sys.boot_completed']) === '1',
    ) ?? null
  const [phone, watch] = await Promise.all(
    avds.map(async (avd) => {
      const device = await waitFor(BOOT_TIMEOUT_MS, () => booted(avd))
      if (!device) fail(`${avd.name} did not finish booting in ${BOOT_TIMEOUT_MS / 1000} s`)
      return device
    }),
  )
  console.log(`wear: ${phone.name} (${phone.serial}) and ${watch.name} (${watch.serial}) are up`)
  return { phone, watch }
}

/** Wear companion pairing port. The companion looks for an emulator behind this forward. */
const PAIR_PORT = 5601

/** The Wear OS companion on the phone; opened when the pairing does not come back on its own. */
const COMPANION_PACKAGE = 'com.google.android.apps.wear.companion'

/** Long enough to click through the companion's first-run "Pair with emulator". */
const PAIR_TIMEOUT_MS = 180_000

/** Play services' Data Layer state on one emulator: nodes, links, sync table, data items. */
function wearableDump(serial: string) {
  return capture([
    'adb',
    '-s',
    serial,
    'shell',
    'dumpsys',
    'activity',
    'service',
    'WearableService',
  ])
}

/** The watch's Data Layer reports a live link to its phone. */
function isLinked(watch: AdbDevice) {
  return wearableDump(watch.serial).includes('IsConnected=true')
}

/**
 * Bridges a watch emulator to a phone. The Data Layer has no radio between an AVD and a phone, so
 * the companion reaches the emulator through an adb forward on the *phone's* port 5601 instead.
 * The forward dies with every adb server restart or replug, so this is a re-runnable repair, not a
 * one-time setup: the pairing itself survives, only the tunnel has to come back. The companion is
 * only opened when the link does not return by itself, which a first pairing never does.
 */
async function pairEmulator(watch: AdbDevice, phone: AdbDevice) {
  run(['adb', '-s', phone.serial, 'forward', `tcp:${PAIR_PORT}`, `tcp:${PAIR_PORT}`])
  if (await waitFor(15_000, () => isLinked(watch) || null)) {
    console.log(`wear: ${watch.name} linked to ${phone.name}`)
    return
  }

  if (
    !capture(['adb', '-s', phone.serial, 'shell', 'pm', 'list', 'packages']).includes(
      COMPANION_PACKAGE,
    )
  ) {
    fail(`no Wear OS companion on ${phone.name} — install "Wear OS" from Play, then re-run`)
  }
  run([
    'adb',
    '-s',
    phone.serial,
    'shell',
    'monkey',
    '-p',
    COMPANION_PACKAGE,
    '-c',
    'android.intent.category.LAUNCHER',
    '1',
  ])
  console.log(
    'wear: first time? in the companion: menu > Pair with emulator, then clear every permission it asks for',
  )
  if (!(await waitFor(PAIR_TIMEOUT_MS, () => isLinked(watch) || null))) {
    fail(
      `${watch.name} never linked to ${phone.name} — pair once in the companion (menu > Pair with emulator), then re-run`,
    )
  }
  console.log(`wear: ${watch.name} linked to ${phone.name}`)
}

/** The node id Play services runs this device's Data Layer as. */
function localNode(dump: string) {
  return dump.match(/localNode: NodeInternal\{id='([0-9a-f]+)'/)?.[1] ?? null
}

/**
 * The newest Data Layer sequence number this device holds from [node], read off the `06-DataSync`
 * table (`nodeId  from  seqId  lastActivity`).
 */
function syncedSeq(dump: string, node: string) {
  const table = dump.split('06-DataSync')[1] ?? ''
  const row = table.match(new RegExp(`^\\s*${node}\\s+\\S+\\s+(\\d+)`, 'm'))
  return row ? Number(row[1]) : null
}

/** The watch's Play services database: data items and the per-node sync high-water marks. */
const WATCH_NODE_DB = '/data/data/com.google.android.gms/databases/node.db'

/**
 * The watch only takes a phone data item numbered above the newest one it already holds from that
 * phone. When the phone's Play services restarts its numbering lower — seen after an emulator
 * restore — the watch silently drops every route, settings, weather and map-tile write from then
 * on, while messages (frames, route status) still flow. The wrist then waits on a route it never
 * receives (#560). Forgetting the phone's items and high-water mark on the watch makes the phone
 * resync everything. Needs a root adb shell, which the Wear emulator images allow.
 */
async function ensureDataSync(watch: AdbDevice, phone: AdbDevice) {
  const phoneDump = wearableDump(phone.serial)
  const node = localNode(phoneDump)
  const phoneSeq = node ? syncedSeq(phoneDump, node) : null
  const watchSeq = node ? syncedSeq(wearableDump(watch.serial), node) : null
  if (node === null || phoneSeq === null || watchSeq === null) {
    fail(`could not read the Data Layer sync table on ${phone.name} or ${watch.name}`)
  }
  if (watchSeq <= phoneSeq) {
    console.log(
      `wear: ${watch.name} takes ${phone.name}'s data items (seq ${watchSeq} <= ${phoneSeq})`,
    )
    return
  }

  console.log(
    `wear: ${watch.name} holds ${phone.name}'s items up to seq ${watchSeq}, the phone is at ${phoneSeq} — resetting the watch's copy`,
  )
  if (capture(['adb', '-s', watch.serial, 'shell', 'getprop', 'ro.debuggable']) !== '1') {
    fail(`${watch.name} has no root adb shell; wipe its data in the device manager and pair again`)
  }
  run(['adb', '-s', watch.serial, 'root'])
  run(['adb', '-s', watch.serial, 'wait-for-device'])
  const sql = [
    `delete from assetrefs where dataitems_id in (select _id from dataitems where sourceNode='${node}')`,
    `delete from dataitems where sourceNode='${node}'`,
    `update nodeinfo set seqId=0 where node='${node}'`,
  ].join('; ')
  // One shell, so Play services has no time to come back with the stale items cached in between.
  run([
    'adb',
    '-s',
    watch.serial,
    'shell',
    `am force-stop ${PLAY_SERVICES}; sqlite3 ${WATCH_NODE_DB} "${sql}"; am force-stop ${PLAY_SERVICES}`,
  ])
  run(['adb', '-s', phone.serial, 'shell', 'am', 'force-stop', PLAY_SERVICES])
  const synced = await waitFor(DATA_RESYNC_TIMEOUT_MS, () => {
    const seq = syncedSeq(wearableDump(watch.serial), node)
    const current = syncedSeq(wearableDump(phone.serial), node)
    return seq !== null && current !== null && seq > 0 && seq <= current ? seq : null
  })
  if (synced === null) fail(`${watch.name} did not resync ${phone.name}'s data items`)
  console.log(`wear: ${watch.name} resynced ${phone.name}'s data items (seq ${synced})`)
}

/** After both Play services restart, the link comes back and the phone resends its items. */
const DATA_RESYNC_TIMEOUT_MS = 90_000

/** How long a cold dev build gets to load its bundle from Metro. */
const JS_START_TIMEOUT_MS = 120_000

/**
 * The dev build counts as loaded once Metro lists it as a debugger target. The process alone proves
 * nothing — the Data Layer wakes it for the watch with no JS loaded, and a cold launch parks on the
 * dev launcher.
 */
async function isOnMetro(phone: AdbDevice, packageName: string) {
  const model = capture(['adb', '-s', phone.serial, 'shell', 'getprop', 'ro.product.model'])
  // intentional-suppression: Metro mid-restart answers nothing; the caller polls until its timeout.
  const targets = (await fetch(`${METRO_URL}/json/list`, { signal: AbortSignal.timeout(5000) })
    .then((response) => response.json())
    .catch(() => [])) as { appId?: string; deviceName?: string }[]
  return targets.some(
    (target) => target.appId === packageName && target.deviceName?.startsWith(`${model} `),
  )
}

/** Installs the phone dev build when missing, then makes sure its JS is running from Metro. */
async function ensurePhoneApp(phone: AdbDevice, packageName: string) {
  const installed = capture(['adb', '-s', phone.serial, 'shell', 'pm', 'list', 'packages'])
    .split('\n')
    .includes(`package:${packageName}`)
  if (!installed) {
    run(['bun', 'run', 'scripts/android.ts', '--device', phone.serial, '--no-bundler'], {
      timeoutMs: BUILD_TIMEOUT_MS,
    })
  }

  const metro = await fetch(`${METRO_URL}/status`, { signal: AbortSignal.timeout(5000) })
    .then((response) => response.text())
    .catch(() => '')
  if (!metro.includes('packager-status:running')) {
    fail(`Metro is not running on ${METRO_URL} — start it with \`bun run start\`, then re-run`)
  }
  // The reverse dies with an adb server restart, like the pairing forward.
  run(['adb', '-s', phone.serial, 'reverse', 'tcp:8081', 'tcp:8081'])
  if (await isOnMetro(phone, packageName)) {
    console.log(`wear: ${packageName} is running from Metro`)
    return
  }

  run([
    'adb',
    '-s',
    phone.serial,
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    devClientUrl('vescape'),
    packageName,
  ])
  if (
    !(await waitFor(JS_START_TIMEOUT_MS, async () => (await isOnMetro(phone, packageName)) || null))
  ) {
    fail(`${packageName} never loaded its JS from Metro in ${JS_START_TIMEOUT_MS / 1000} s`)
  }
}

/** Builds and re-signs the watch app, and installs it unless the watch already has this build. */
function ensureWatchApp(watch: AdbDevice, packageName: string) {
  gradle(':wearos:assembleDebug')
  signWithPhoneCert()
  if (isInstalled(watch.serial, packageName)) {
    console.log(`wear: ${watch.name} already has this build`)
    return
  }
  install(watch.serial, packageName)
}

/** From a fresh Mirror process to its first decoded frame, on a healthy link. */
const FRAME_TIMEOUT_MS = 45_000
/** After Play services restarts, the Data Layer reconnects before frames flow again. */
const FRAME_RECOVERY_TIMEOUT_MS = 90_000
const PLAY_SERVICES = 'com.google.android.gms'

/** Starts a fresh Mirror and waits for its `VescMirror` "first frame received" line. */
function launchForFrame(watch: AdbDevice, packageName: string, timeoutMs: number) {
  launch(watch.serial, packageName)
  smokeCheck(watch.serial)
  return waitForLog(watch.serial, 'VescMirror', [/first frame received/], timeoutMs)
}

/**
 * Proves the mirror end to end. On the emulators the Data Layer often wedges after either side
 * restarts: WearableService still logs `/telemetry` inbound, but the app never gets it. Restarting
 * Play services on both sides is the known cure, so it is tried once before giving up.
 */
async function waitForFirstFrame(watch: AdbDevice, phone: AdbDevice, packageName: string) {
  if (await launchForFrame(watch, packageName, FRAME_TIMEOUT_MS)) return

  console.log('\nwear: no frame on the wrist — restarting Play services on both emulators')
  for (const device of [phone, watch]) {
    run(['adb', '-s', device.serial, 'shell', 'am', 'force-stop', PLAY_SERVICES])
  }
  if (await launchForFrame(watch, packageName, FRAME_RECOVERY_TIMEOUT_MS)) return

  fail(
    `no frame reached ${watch.name}, even after restarting Play services — see docs/agents/watch-emulators.md`,
  )
}

/**
 * Takes a machine from no emulators to a phone emulator and a Wear emulator that are paired and
 * mirroring, with frames on the wrist. Each step checks before it acts, so a re-run with both up
 * only proves the frames again.
 */
async function up(requestedPhone: string | null) {
  begin('boot emulators')
  const { phone, watch } = await bootEmulators(requestedPhone)

  begin('pair')
  await pairEmulator(watch, phone)

  begin('data sync')
  await ensureDataSync(watch, phone)

  begin('native sync')
  syncNative()
  const packageName = applicationId()

  begin('phone app')
  await ensurePhoneApp(phone, packageName)

  begin('watch app')
  ensureWatchApp(watch, packageName)

  begin('first frame')
  await waitForFirstFrame(watch, phone, packageName)
  step = null
  console.log(`\nwear: ${watch.name} is mirroring ${phone.name}`)
  return { phone, watch, packageName }
}

/**
 * A link that lands before Expo Router subscribes to it is dropped, and a booting app gives no
 * signal for that moment, so the ride link is resent until the phone logs that it received it.
 */
const RIDE_ATTEMPTS = 4
const RIDE_ATTEMPT_TIMEOUT_MS = 20_000
/** From the link landing to a running ride: the route's first replayed fix (60 s), then Directions. */
const RIDE_START_TIMEOUT_MS = 90_000

/**
 * Takes the emulators through `up`, then starts a watch ride with the dev-only ride link on the
 * phone — thor301 replay plus normal Navigation, whose route native pushes to the wrist like on any
 * ride.
 */
async function startRide(requestedPhone: string | null) {
  const { watch, phone, packageName } = await up(requestedPhone)

  begin('ride')
  run(['adb', '-s', phone.serial, 'logcat', '-c'])
  let received: string | null = null
  for (let attempt = 0; attempt < RIDE_ATTEMPTS && !received; attempt++) {
    run([
      'adb',
      '-s',
      phone.serial,
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      `'${watchRideUrl('vescape')}'`,
      packageName,
    ])
    received = await waitForLog(
      phone.serial,
      'ReactNativeJS',
      [/\[watch-ride\] .* received/],
      RIDE_ATTEMPT_TIMEOUT_MS,
    )
  }
  if (!received) fail('the phone never received the ride link — is this a dev build on Metro?')
  const outcome = await waitForLog(
    phone.serial,
    'ReactNativeJS',
    [/\[watch-ride\] .* running/, /\[watch-ride\] failed/],
    RIDE_START_TIMEOUT_MS,
  )
  if (!outcome) fail('the phone received the ride link but never reported it running')
  if (outcome.includes('failed')) fail(outcome)
  console.log(`\nwear: ${outcome.trim()}`)
  console.log(
    `wear: route goes to the wrist once Directions answers — \`adb -s ${watch.serial} exec-out screencap -p > watch.png\``,
  )
}

/**
 * Restarts the Mirror on the chosen lane fixture, joined to the fixture Group Ride with `--group`. `-S` because a running activity keeps the intent
 * it was started with, so without it the extra is delivered but never read.
 */
async function startReplay(
  fixture: string,
  group: boolean,
  wander: boolean,
  navigation: boolean,
  telemetryTrail: boolean,
  requested: string | null,
  routeLoading: boolean,
) {
  const serial = (await findWatch(requested)).serial
  const packageName = applicationId()
  console.log(`\nwear: replaying ${fixture}${group ? ' in a Group Ride' : ''} on ${serial}`)
  run([
    'adb',
    '-s',
    serial,
    'shell',
    'am',
    'start',
    '-S',
    '-n',
    `${packageName}/${ACTIVITY_CLASS}`,
    '--es',
    'replay',
    fixture,
    '--ez',
    'group',
    String(group),
    '--ez',
    'wander',
    String(wander),
    '--ez',
    'navigation',
    String(navigation),
    '--ez',
    'telemetryTrail',
    String(telemetryTrail),
    '--ez',
    'route-loading',
    String(routeLoading),
  ])
}

const args = process.argv.slice(2)

// `--device` skips the picker, and is the only way to choose a watch without a TTY.
const deviceFlag = args.findIndex((arg) => arg === '--device' || arg === '-d')
const requested = deviceFlag === -1 ? null : (args[deviceFlag + 1] ?? null)
if (deviceFlag !== -1) {
  if (!requested) fail('--device needs a serial or model')
  args.splice(deviceFlag, 2)
}

const command = args[0] as Command | undefined
if (!command || !COMMANDS.includes(command)) {
  console.error(`Usage: bun run scripts/wear.ts <${COMMANDS.join('|')}> [--device <serial|model>]`)
  process.exit(1)
}

if (command === 'pair') {
  const watch = watches().find((it) => it.isEmulator)
  if (!watch) fail('no watch emulator running — start one with `bun run wear:emulator`')
  await pairEmulator(watch, await findPhone(requested))
  process.exit(0)
}

if (command === 'up') {
  await up(requested)
  process.exit(0)
}

if (command === 'ride') {
  await startRide(requested)
  process.exit(0)
}

if (command === 'emulator') {
  await startEmulator()
  process.exit(0)
}

if (command === 'replay') {
  const routeLoadingFlag = args.indexOf('--route-loading')
  if (routeLoadingFlag !== -1) args.splice(routeLoadingFlag, 1)
  const groupFlag = args.indexOf('--group')
  if (groupFlag !== -1) args.splice(groupFlag, 1)
  const wanderFlag = args.indexOf('--wander')
  if (wanderFlag !== -1) args.splice(wanderFlag, 1)
  const noNavigationFlag = args.indexOf('--no-navigation')
  if (noNavigationFlag !== -1) args.splice(noNavigationFlag, 1)
  const noTelemetryTrailFlag = args.indexOf('--no-telemetry-trail')
  if (noTelemetryTrailFlag !== -1) args.splice(noTelemetryTrailFlag, 1)
  const fixture = args[1] ?? 'ride'
  if (!REPLAY_FIXTURES.includes(fixture as (typeof REPLAY_FIXTURES)[number])) {
    fail(`unknown fixture ${fixture} — expected ${REPLAY_FIXTURES.join(' | ')}`)
  }
  await startReplay(
    fixture,
    groupFlag !== -1,
    wanderFlag !== -1,
    noNavigationFlag === -1,
    noTelemetryTrailFlag === -1,
    requested,
    routeLoadingFlag !== -1,
  )
  process.exit(0)
}

// Asked before anything is built: a prompt that appears after a minute of Gradle reads as a build
// that finished, and the answer cannot change what gets built anyway.
const target = command === 'install' ? await findWatch(requested) : null

syncNative()

if (command === 'test') {
  gradle(':wearos:testDebugUnitTest')
} else {
  gradle(':wearos:assembleDebug')

  if (target) {
    signWithPhoneCert()
    const serial = target.serial
    const packageName = applicationId()
    console.log(`\nwear: targeting ${packageName} on ${serial}`)
    install(serial, packageName)
    launch(serial, packageName)
    smokeCheck(serial)
  }
}
