import { existsSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

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

const COMMANDS = ['build', 'test', 'install', 'emulator', 'replay'] as const
type Command = (typeof COMMANDS)[number]

/** Wear AVD booted by `emulator`. Overridable so the AVD name is not baked into the repo. */
const WEAR_AVD = process.env.WEAR_AVD ?? 'WearLarge'

/** Lane fixtures the emulator build replays, keyed by the `replay` intent extra MainActivity reads. */
const REPLAY_FIXTURES = ['ride', 'sweep'] as const

function fail(message: string): never {
  console.error(`\nwear: ${message}`)
  process.exit(1)
}

function run(command: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  console.log(`\n> ${command.join(' ')}\n`)

  const result = Bun.spawnSync(command, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  })

  // `exitCode` is null when the child dies from a signal, so report the signal rather than "null".
  if (!result.success) {
    fail(`${command[0]} exited with ${result.exitCode ?? `signal ${result.signalCode}`}`)
  }
}

function capture(command: string[]) {
  const result = Bun.spawnSync(command, { cwd: ROOT, env: process.env })
  return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : ''
}

function gradle(task: string) {
  // The generated Android project's Expo/RN Gradle plugins shell out to node during configuration,
  // and a non-interactive shell often has no node on PATH — same dance as the `test:android` script.
  const node = Bun.which('node')
  if (!node) fail('node not found on PATH')

  run(['./gradlew', task], {
    cwd: join(ROOT, 'android'),
    env: { NODE_BINARY: node, PATH: `${dirname(node)}:${process.env.PATH}` },
  })
}

/** `android/wearos/` is generated from `watch/wearos/` by the withWearMirror plugin during prebuild. */
function syncNative() {
  run(['bun', 'run', 'scripts/native-sync.ts', 'android'])
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

function sdkRoot() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (!sdk) fail('ANDROID_HOME / ANDROID_SDK_ROOT not set')
  return sdk
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

/**
 * The OnePlus Watch 3 shows up twice over mDNS, so pick devices by what they are rather than by a
 * remembered transport id: only a watch reports `ro.build.characteristics=watch`.
 */
function findWatch() {
  const lines = capture(['adb', 'devices'])
    .split('\n')
    .slice(1)
    .filter((line) => line.includes('\tdevice'))

  const watches = lines
    .map((line) => line.split('\t')[0])
    .filter((serial) =>
      capture(['adb', '-s', serial, 'shell', 'getprop', 'ro.build.characteristics']).includes(
        'watch',
      ),
    )

  if (watches.length === 0) fail('no Wear OS device connected (`adb devices` shows none)')
  if (watches.length > 1) {
    console.log(`wear: ${watches.length} watch transports (mDNS duplicate), using ${watches[0]}`)
  }

  return watches[0]
}

function install(serial: string, packageName: string) {
  const result = Bun.spawnSync(['adb', '-s', serial, 'install', '-r', SIGNED_APK], {
    cwd: ROOT,
    env: process.env,
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
  // the smoke check fail on a healthy app. Clear it here and everything it holds afterwards is ours.
  run(['adb', '-s', serial, 'logcat', '-b', 'crash', '-c'])
  run(['adb', '-s', serial, 'shell', 'am', 'start', '-W', '-n', `${packageName}/${ACTIVITY_CLASS}`])
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
 * Boots the Wear AVD detached, so the shell that started it is free again. A watch emulator is the
 * only place the Mirror replays fixtures instead of mirroring a phone, so this is the entry point
 * for working on wrist visuals without a board.
 */
function startEmulator() {
  const binary = join(sdkRoot(), 'emulator', 'emulator')
  if (!existsSync(binary)) fail(`no emulator installed at ${binary}`)

  const running = capture(['adb', 'devices'])
    .split('\n')
    .slice(1)
    .map((line) => line.split(/\s+/)[0])
    .filter((serial) => serial?.startsWith('emulator-'))
    .some((serial) =>
      capture(['adb', '-s', serial, 'shell', 'getprop', 'ro.build.characteristics']).includes(
        'watch',
      ),
    )
  if (running) {
    console.log('wear: a watch emulator is already running')
    return
  }

  console.log(`\n> emulator -avd ${WEAR_AVD}\n`)
  Bun.spawn([binary, '-avd', WEAR_AVD], { stdio: ['ignore', 'ignore', 'ignore'] }).unref()
  console.log(`wear: booting ${WEAR_AVD} (override with WEAR_AVD)`)
}

/**
 * Restarts the Mirror on the chosen lane fixture. `-S` because a running activity keeps the intent
 * it was started with, so without it the extra is delivered but never read.
 */
function startReplay(fixture: string) {
  const serial = findWatch()
  const packageName = applicationId()
  console.log(`\nwear: replaying ${fixture} on ${serial}`)
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
  ])
}

const command = process.argv[2] as Command | undefined
if (!command || !COMMANDS.includes(command)) {
  console.error(`Usage: bun run scripts/wear.ts <${COMMANDS.join('|')}>`)
  process.exit(1)
}

if (command === 'emulator') {
  startEmulator()
  process.exit(0)
}

if (command === 'replay') {
  const fixture = process.argv[3] ?? 'ride'
  if (!REPLAY_FIXTURES.includes(fixture as (typeof REPLAY_FIXTURES)[number])) {
    fail(`unknown fixture ${fixture} — expected ${REPLAY_FIXTURES.join(' | ')}`)
  }
  startReplay(fixture)
  process.exit(0)
}

syncNative()

if (command === 'test') {
  gradle(':wearos:testDebugUnitTest')
} else {
  gradle(':wearos:assembleDebug')

  if (command === 'install') {
    signWithPhoneCert()
    const serial = findWatch()
    const packageName = applicationId()
    console.log(`\nwear: targeting ${packageName} on ${serial}`)
    install(serial, packageName)
    launch(serial, packageName)
    smokeCheck(serial)
  }
}
