import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

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

if (command !== 'build' && command !== 'replay') fail('Use watchos:build or watchos:replay')

const ios = join(ROOT, 'ios')
if (!existsSync(ios)) fail('Generate the iOS project first with bun run native:sync ios')
const projects = readdirSync(ios).filter((name) => name.endsWith('.xcodeproj'))
if (projects.length !== 1) fail('Expected exactly one Xcode project in ios/')

let deviceId = ''
if (command === 'replay') {
  const { devices } = JSON.parse(
    run(['xcrun', 'simctl', 'list', 'devices', 'available', '--json'], true),
  ) as {
    devices: Record<string, { udid: string; state: string; name: string }[]>
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

if (command === 'replay') {
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
  run([
    'xcrun',
    'simctl',
    'launch',
    '--terminate-running-process',
    deviceId,
    build.PRODUCT_BUNDLE_IDENTIFIER,
    '--replay',
    join(ROOT, 'watch/wearos/src/main/assets/watch-ride.jsonl'),
  ])
}
