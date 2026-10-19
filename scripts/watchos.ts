import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { METRO_URL, watchRideUrl } from './lib/devLinks.ts'

const ROOT = join(import.meta.dir, '..')
const command = Bun.argv[2]

function fail(message: string): never {
  console.error(`watchos: ${message}`)
  process.exit(1)
}

function run(args: string[], capture = false): string {
  const result = Bun.spawnSync(args, {
    cwd: ROOT,
    stdout: capture ? 'pipe' : 'inherit',
    stderr: 'inherit',
  })
  if (!result.success) fail(`${args[0]} failed (${result.exitCode ?? result.signalCode})`)
  return capture ? new TextDecoder().decode(result.stdout) : ''
}

if (command !== 'build' && command !== 'replay' && command !== 'ride') {
  fail('Use watchos:build, watchos:replay or watchos:ride')
}

const ios = join(ROOT, 'ios')
if (!existsSync(ios)) fail('Generate the iOS project first with bun run native:sync ios')
const projects = readdirSync(ios).filter((name) => name.endsWith('.xcodeproj'))
if (projects.length !== 1) fail('Expected exactly one Xcode project in ios/')

interface Simulator {
  udid: string
  state: string
  name: string
}

let deviceId = ''
let phoneId = ''
if (command === 'ride') {
  // The ride needs the watch's own phone: WatchConnectivity only talks across a connected pair.
  const { pairs } = JSON.parse(run(['xcrun', 'simctl', 'list', 'pairs', '--json'], true)) as {
    pairs: Record<string, { watch: Simulator; phone: Simulator; state: string }>
  }
  const booted = Object.values(pairs)
    .filter((pair) => pair.state === '(active, connected)')
    .filter((pair) => pair.watch.state === 'Booted' && pair.phone.state === 'Booted')
    .filter((pair) => !process.env.WATCHOS_UDID || pair.watch.udid === process.env.WATCHOS_UDID)
  if (booted.length !== 1) {
    fail(
      'Boot one connected phone + watch pair (`xcrun simctl list pairs`), or select its watch with WATCHOS_UDID=<uuid>',
    )
  }
  deviceId = booted[0]!.watch.udid
  phoneId = booted[0]!.phone.udid
} else if (command === 'replay') {
  const { devices } = JSON.parse(
    run(['xcrun', 'simctl', 'list', 'devices', 'available', '--json'], true),
  ) as {
    devices: Record<string, Simulator[]>
  }
  const watches = Object.entries(devices)
    .filter(([runtime]) => runtime.includes('watchOS'))
    .flatMap(([, entries]) => entries)
    .filter((device) => device.state === 'Booted')
    .filter((device) => !process.env.WATCHOS_UDID || device.udid === process.env.WATCHOS_UDID)
  if (watches.length !== 1) {
    fail('Boot one watch simulator, or select a booted watch with WATCHOS_UDID=<uuid>')
  }
  deviceId = watches[0]!.udid
}

const args = [
  '-project',
  join(ios, projects[0]!),
  '-target',
  'VescapeWatch',
  '-configuration',
  'Debug',
  '-sdk',
  'watchsimulator',
]
run(['xcodebuild', 'build', ...args])

if (command === 'replay' || command === 'ride') {
  const settings = JSON.parse(
    run(['xcodebuild', ...args, '-showBuildSettings', '-json'], true),
  ) as {
    target: string
    buildSettings: Record<string, string>
  }[]
  const build = settings.find((entry) => entry.target === 'VescapeWatch')?.buildSettings
  if (!build?.TARGET_BUILD_DIR || !build.FULL_PRODUCT_NAME || !build.PRODUCT_BUNDLE_IDENTIFIER) {
    fail('Missing watch app paths in Xcode build settings')
  }
  run([
    'xcrun',
    'simctl',
    'install',
    deviceId,
    join(build.TARGET_BUILD_DIR, build.FULL_PRODUCT_NAME),
  ])
  if (command === 'ride') {
    run([
      'xcrun',
      'simctl',
      'launch',
      '--terminate-running-process',
      deviceId,
      build.PRODUCT_BUNDLE_IDENTIFIER,
    ])
    startPhoneRide(build.PRODUCT_BUNDLE_IDENTIFIER.replace(/\.watchkitapp$/, ''))
    process.exit(0)
  }
  run([
    'xcrun',
    'simctl',
    'launch',
    '--terminate-running-process',
    deviceId,
    build.PRODUCT_BUNDLE_IDENTIFIER,
    '--replay',
    join(ROOT, 'watch/wearos/src/main/assets/watch-ride.jsonl'),
    ...['--group', '--wander', '--no-navigation', '--no-telemetry-trail', '--route-loading'].filter(
      (flag) => Bun.argv.includes(flag),
    ),
  ])
}

/**
 * Phone side of `watchos:ride`: the dev build relaunched on Metro, then the dev-only ride link —
 * thor301 replay plus normal Navigation, whose route native pushes to the wrist like on any ride.
 *
 * The launch takes Metro's URL as an argument, which the dev launcher reads without a prompt. The
 * ride link follows at once: a link that arrives while the bundle loads is held by the dev launcher
 * and handed to the app as its initial URL, so there is no JS-ready moment to wait for — which is
 * as well, because an iOS dev build's `console.log` never reaches the simulator log to be waited on.
 */
function startPhoneRide(bundleId: string) {
  const installed = Bun.spawnSync(['xcrun', 'simctl', 'get_app_container', phoneId, bundleId])
  if (!installed.success) {
    fail(`${bundleId} missing on the phone simulator — run \`bun run ios\` once`)
  }

  run([
    'xcrun',
    'simctl',
    'launch',
    '--terminate-running-process',
    phoneId,
    bundleId,
    '--initialUrl',
    METRO_URL,
  ])
  run(['xcrun', 'simctl', 'openurl', phoneId, watchRideUrl(bundleId)])
  console.log('watchos: ride link sent — if the phone asks "Open in …?", tap Open')
  console.log(
    `watchos: the route reaches the wrist once Directions answers — \`xcrun simctl io ${deviceId} screenshot watch.png\``,
  )
}
