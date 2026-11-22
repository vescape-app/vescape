import { existsSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { verifyWatchTelemetry } from './lib/watchTelemetryE2e.ts'
import { dirname, join } from 'path'
import { sdkRoot } from './lib/androidSdk.ts'
import { bootAvd, isAvdRunning, pickAvd, type Avd } from './lib/avds.ts'
import { listAdbDevices, pickDevice, type AdbDevice } from './lib/devices.ts'
import { devClientUrl, METRO_URL, watchRideUrl } from './lib/devLinks.ts'

const ROOT = join(import.meta.dir, '..')
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

const PHONE_KEYSTORE = join(ROOT, 'android', 'app', 'debug.keystore')
const SIGNED_APK = join(tmpdir(), 'wearos-debug-phone-cert-signed.apk')

const COMMANDS = [
  'build',
  'test',
  'install',
  'emulator',
  'replay',
  'pair',
  'up',
  'ride',
  'e2e',
] as const
type Command = (typeof COMMANDS)[number]

const WEAR_AVD = process.env.WEAR_AVD ?? null

const REPLAY_FIXTURES = ['ride', 'sweep', 'preview'] as const

let step: string | null = null

function begin(name: string) {
  step = name
  console.log(`\nwear: — ${name}`)
}

function fail(message: string): never {
  console.error(`\nwear: ${step ? `${step} failed: ` : ''}${message}`)
  process.exit(1)
}

const COMMAND_TIMEOUT_MS = 120_000
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
  if (!result.success) {
    fail(`${command[0]} exited with ${result.exitCode ?? `signal ${result.signalCode}`}`)
  }
}

function capture(command: string[]) {
  const result = Bun.spawnSync(command, { cwd: ROOT, env: process.env, timeout: 30_000 })
  return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : ''
}

async function waitFor<T>(timeoutMs: number, probe: () => T | null | Promise<T | null>) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== null) return value
    await Bun.sleep(1000)
  }
  return null
}

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
  const node = Bun.which('node')
  if (!node) fail('node not found on PATH')

  run(['./gradlew', task], {
    cwd: join(ROOT, 'android'),
    env: { NODE_BINARY: node, PATH: `${dirname(node)}:${process.env.PATH}` },
    timeoutMs: BUILD_TIMEOUT_MS,
  })
}

function syncNative() {
  run(['bun', 'run', 'scripts/native-sync.ts', 'android'], { timeoutMs: BUILD_TIMEOUT_MS })
}

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

  if (
    !output.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE') &&
    !output.includes('INSTALL_FAILED_VERSION_DOWNGRADE')
  ) {
    fail(`install failed with ${result.exitCode}`)
  }

  console.log('\nwear: incompatible existing install, reinstalling')
  run(['adb', '-s', serial, 'uninstall', packageName])
  run(['adb', '-s', serial, 'install', SIGNED_APK])
}

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

  run(['adb', '-s', serial, 'logcat', '-b', 'main', '-b', 'crash', '-c'])
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

async function startEmulator() {
  const avd = await pickAvd(true, WEAR_AVD)
  if (isAvdRunning(avd.name)) {
    console.log(`wear: ${avd.name} is already running`)
    return
  }
  bootAvd(avd.name)
  console.log(`wear: booting ${avd.name} (override with WEAR_AVD)`)
}

const BOOT_TIMEOUT_MS = 300_000

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

const PAIR_PORT = 5601

const COMPANION_PACKAGE = 'com.google.android.apps.wear.companion'

const PAIR_TIMEOUT_MS = 180_000

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

function isLinked(watch: AdbDevice) {
  return wearableDump(watch.serial).includes('IsConnected=true')
}

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
    'wear: first time? in the companion: menu > Pair with emulator, then accept every permission it asks for',
  )
  if (!(await waitFor(PAIR_TIMEOUT_MS, () => isLinked(watch) || null))) {
    fail(
      `${watch.name} never linked to ${phone.name} — pair once in the companion (menu > Pair with emulator), then re-run`,
    )
  }
  console.log(`wear: ${watch.name} linked to ${phone.name}`)
}

function localNode(dump: string) {
  return dump.match(/localNode: NodeInternal\{id='([0-9a-f]+)'/)?.[1] ?? null
}

function syncedSeq(dump: string, node: string) {
  const table = dump.split('06-DataSync')[1] ?? ''
  const row = table.match(new RegExp(`^\\s*${node}\\s+\\S+\\s+(\\d+)`, 'm'))
  return row ? Number(row[1]) : null
}

const WATCH_NODE_DB = '/data/data/com.google.android.gms/databases/node.db'

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

const DATA_RESYNC_TIMEOUT_MS = 90_000

const JS_START_TIMEOUT_MS = 120_000

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

async function ensurePhoneApp(
  phone: AdbDevice,
  packageName: string,
  rebuild = false,
  grantTestPermissions = false,
) {
  const installed = capture(['adb', '-s', phone.serial, 'shell', 'pm', 'list', 'packages'])
    .split('\n')
    .includes(`package:${packageName}`)
  if (!installed || rebuild) {
    run(
      [
        'bun',
        'run',
        'scripts/android.ts',
        '--device',
        phone.serial,
        ...(process.env.E2E_METRO_PORT ? ['--port', process.env.E2E_METRO_PORT] : ['--no-bundler']),
      ],
      { timeoutMs: BUILD_TIMEOUT_MS },
    )
    run(['adb', '-s', phone.serial, 'shell', 'am', 'force-stop', 'com.google.android.gms'])
  }

  if (grantTestPermissions) {
    const sdk = Number(
      capture(['adb', '-s', phone.serial, 'shell', 'getprop', 'ro.build.version.sdk']),
    )
    const permissions = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACTIVITY_RECOGNITION']
    if (sdk >= 31) permissions.push('BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT')
    if (sdk >= 33) permissions.push('POST_NOTIFICATIONS')
    for (const permission of permissions) {
      run([
        'adb',
        '-s',
        phone.serial,
        'shell',
        'pm',
        'grant',
        packageName,
        `android.permission.${permission}`,
      ])
    }
  }

  const metro = await fetch(`${METRO_URL}/status`, { signal: AbortSignal.timeout(5000) })
    .then((response) => response.text())
    .catch(() => '')
  if (!metro.includes('packager-status:running')) {
    fail(`Metro is not running on ${METRO_URL} — start it with \`bun run start\`, then re-run`)
  }
  run([
    'adb',
    '-s',
    phone.serial,
    'reverse',
    `tcp:${new URL(METRO_URL).port}`,
    `tcp:${new URL(METRO_URL).port}`,
  ])
  if (await isOnMetro(phone, packageName)) {
    console.log(`wear: ${packageName} is running from Metro`)
    return
  }

  run(['adb', '-s', phone.serial, 'shell', 'am', 'force-stop', packageName])
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
    devClientUrl('exp+vescape'),
    packageName,
  ])
  if (
    !(await waitFor(JS_START_TIMEOUT_MS, async () => (await isOnMetro(phone, packageName)) || null))
  ) {
    fail(`${packageName} never loaded its JS from Metro in ${JS_START_TIMEOUT_MS / 1000} s`)
  }
}

function ensureWatchApp(watch: AdbDevice, packageName: string) {
  gradle(':wearos:assembleDebug')
  signWithPhoneCert()
  if (isInstalled(watch.serial, packageName)) {
    console.log(`wear: ${watch.name} already has this build`)
    return
  }
  install(watch.serial, packageName)
}

const FRAME_TIMEOUT_MS = 45_000
const FRAME_RECOVERY_TIMEOUT_MS = 90_000
const PLAY_SERVICES = 'com.google.android.gms'

function launchForFrame(watch: AdbDevice, packageName: string, timeoutMs: number) {
  launch(watch.serial, packageName)
  smokeCheck(watch.serial)
  return waitForLog(watch.serial, 'VescMirror', [/first frame received/], timeoutMs)
}

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

async function up(requestedPhone: string | null, rebuildPhone = false, clearPhone = false) {
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
  if (
    clearPhone &&
    capture(['adb', '-s', phone.serial, 'shell', 'pm', 'path', packageName]).startsWith('package:')
  ) {
    run(['adb', '-s', phone.serial, 'shell', 'pm', 'clear', packageName])
  }
  await ensurePhoneApp(phone, packageName, rebuildPhone, clearPhone)

  begin('watch app')
  ensureWatchApp(watch, packageName)

  begin('first frame')
  await waitForFirstFrame(watch, phone, packageName)
  step = null
  console.log(`\nwear: ${watch.name} is mirroring ${phone.name}`)
  return { phone, watch, packageName }
}

const RIDE_ATTEMPTS = 4
const RIDE_ATTEMPT_TIMEOUT_MS = 20_000
const RIDE_START_TIMEOUT_MS = 90_000

async function startRide(
  requestedPhone: string | null,
  { navigation = true, rebuildPhone = false, clearPhone = false } = {},
) {
  const { watch, phone, packageName } = await up(requestedPhone, rebuildPhone, clearPhone)

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
      `'${watchRideUrl('vescape', navigation)}'`,
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
  if (navigation)
    console.log(
      `wear: route goes to the wrist once Directions answers — \`adb -s ${watch.serial} exec-out screencap -p > watch.png\``,
    )
  return { watch, phone, packageName }
}

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
  await up(requested, args.includes('--rebuild-phone'), args.includes('--clear-phone'))
  process.exit(0)
}

if (command === 'e2e') {
  const { watch, phone, packageName } = await startRide(requested, {
    navigation: false,
    rebuildPhone: true,
    clearPhone: true,
  })
  begin('watch telemetry E2E')
  await waitForFirstFrame(watch, phone, packageName)
  const artifacts = join(ROOT, '.expo', 'watch-e2e', new Date().toISOString().replaceAll(':', '-'))
  await verifyWatchTelemetry(watch.serial, packageName, artifacts)
  step = null
  console.log('\nWatch E2E passed: phone replay → Data Layer → changing wrist telemetry.')
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
