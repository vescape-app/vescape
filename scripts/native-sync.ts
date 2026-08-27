import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { copyShared, sharedOutput, sharedSources, sharedTargets } from './copy-shared.ts'

const ROOT = join(import.meta.dir, '..')
const CACHE_DIR = join(ROOT, '.expo', 'native-sync')

const PLATFORMS = ['ios', 'android'] as const
export type Platform = (typeof PLATFORMS)[number]

/**
 * Durable inputs that Expo prebuild turns into `ios/` and `android/`. Files or directories,
 * repo-relative. Anything generated (`ios/`, `android/`, Pods) is output, never input.
 */
const PREBUILD_INPUTS = [
  'app.config.ts',
  'src/config/appVariant.ts',
  'package.json',
  'bun.lock',
  'plugins',
  'patches',
  // Prebuild reads the loaded env: `app.config.ts` and the plugins bake values (server origin,
  // Sentry DSN, Apple team) into the native projects, so an env edit is a native input.
  '.env',
  '.env.local',
  // Every file here is baked into the native projects by prebuild (launcher icon, adaptive icon
  // layers, splash). Images the JS bundle loads at runtime live in `assets/logo` and
  // `assets/map-points`, so this stays narrow enough not to prebuild on unrelated art edits.
  'assets/images',
]

/** iOS-only prebuild inputs: `@bacons/apple-targets` copies these into the generated Xcode project. */
const IOS_PREBUILD_INPUTS = ['targets']

/** Android-only prebuild inputs: `withWearMirror` copies the Wear OS Mirror into `android/wearos/`. */
const ANDROID_PREBUILD_INPUTS = ['watch']

/** Per-Expo-module prebuild inputs: native registration and dependency declarations. */
const MODULE_PREBUILD_INPUTS = ['expo-module.config.json', 'package.json']

const IGNORED_ENTRIES = new Set(['.DS_Store', '.build', 'node_modules'])

/** Input key -> content hash (or, for `#layout` keys, a hash of the file path list). */
export type Fingerprint = Record<string, string>

export interface NativeState {
  shared: Fingerprint
  prebuild: Fingerprint
  pods: Fingerprint
}

export interface Diff {
  added: string[]
  removed: string[]
  changed: string[]
}

export type SyncAction = 'shared' | 'prebuild' | 'pods'

export interface SyncStep {
  action: SyncAction
  reasons: string[]
}

function hash(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function walk(absolute: string): string[] {
  if (!existsSync(absolute)) return []
  if (statSync(absolute).isFile()) return [absolute]

  return readdirSync(absolute)
    .filter((entry) => !IGNORED_ENTRIES.has(entry))
    .flatMap((entry) => walk(join(absolute, entry)))
    .sort()
}

function moduleDirs(root: string) {
  const modules = join(root, 'modules')
  if (!existsSync(modules)) return []
  return readdirSync(modules)
    .map((name) => join(modules, name))
    .filter((path) => statSync(path).isDirectory())
}

function hashFiles(paths: string[], root: string, into: Fingerprint) {
  for (const path of paths) {
    into[relative(root, path)] = hash(readFileSync(path))
  }
}

export function prebuildFingerprint(platform: Platform, root = ROOT): Fingerprint {
  const fingerprint: Fingerprint = {}
  const inputs = [
    ...PREBUILD_INPUTS,
    ...(platform === 'ios' ? IOS_PREBUILD_INPUTS : ANDROID_PREBUILD_INPUTS),
  ]

  for (const input of inputs) {
    hashFiles(walk(join(root, input)), root, fingerprint)
  }

  for (const module of moduleDirs(root)) {
    const moduleInputs = MODULE_PREBUILD_INPUTS.map((name) => join(module, name)).filter((path) =>
      existsSync(path),
    )
    hashFiles(moduleInputs, root, fingerprint)
  }

  return fingerprint
}

/**
 * CocoaPods compiles whatever the podspec globbed at `pod install` time, so Pods go stale when the
 * *file list* under a module's `ios/` changes — a new Swift file is invisible to Xcode until Pods
 * are regenerated. Edits to already-compiled files are picked up by Xcode directly, so this hashes
 * the sorted path list, not file contents. Podspecs are hashed by content: they define the globs.
 */
export function podsFingerprint(root = ROOT): Fingerprint {
  const fingerprint: Fingerprint = {}

  for (const module of moduleDirs(root)) {
    const iosDir = join(module, 'ios')
    if (!existsSync(iosDir)) continue

    const files = walk(iosDir)
    hashFiles(
      files.filter((path) => path.endsWith('.podspec')),
      root,
      fingerprint,
    )

    const layout = files.map((path) => relative(root, path)).join('\n')
    fingerprint[`${relative(root, iosDir)}#layout`] = hash(layout)
  }

  return fingerprint
}

/**
 * `shared/` is the single source of truth for alert audio and shared data catalogs. Android needs real
 * copies of it inside the module (Gradle cannot follow a symlink out of the module), so those copies
 * are generated state that drifts whenever `shared/` changes — or whenever someone deletes them.
 */
export function sharedFingerprint(root = ROOT): Fingerprint {
  const fingerprint: Fingerprint = {}

  for (const target of sharedTargets(root)) {
    hashFiles(sharedSources(target), root, fingerprint)
  }

  return fingerprint
}

/** Copies `copyShared()` should have produced but that are not on disk. */
export function missingSharedOutputs(root = ROOT): string[] {
  return sharedTargets(root)
    .flatMap((target) => sharedSources(target).map((source) => sharedOutput(target, source)))
    .filter((output) => !existsSync(output))
    .map((output) => relative(root, output))
}

export function diffFingerprints(previous: Fingerprint, next: Fingerprint): Diff {
  const added = Object.keys(next).filter((key) => !(key in previous))
  const removed = Object.keys(previous).filter((key) => !(key in next))
  const changed = Object.keys(next).filter((key) => key in previous && previous[key] !== next[key])
  return { added, removed, changed }
}

function isEmpty(fingerprint: Fingerprint) {
  return Object.keys(fingerprint).length === 0
}

function describe(diff: Diff) {
  return [
    ...diff.added.map((key) => `+ ${key}`),
    ...diff.removed.map((key) => `- ${key}`),
    ...diff.changed.map((key) => `~ ${key}`),
  ]
}

export function planSync(input: {
  platform: Platform
  nativeDirExists: boolean
  podsDirExists: boolean
  missingSharedOutputs: string[]
  cached: NativeState | null
  next: NativeState
}): SyncStep[] {
  const { platform, nativeDirExists, podsDirExists, missingSharedOutputs, cached, next } = input
  const steps: SyncStep[] = []

  // Android compiles the copies under `modules/vescape-core/android/src/`; iOS reads `shared/` through
  // symlinks, so it has nothing to copy.
  if (platform === 'android') {
    const cachedShared = cached?.shared ?? {}
    const shared = isEmpty(cachedShared)
      ? ['no cached shared-asset fingerprint']
      : [
          ...missingSharedOutputs.map((path) => `! ${path} is missing`),
          ...describe(diffFingerprints(cachedShared, next.shared)),
        ]

    if (shared.length > 0) steps.push({ action: 'shared', reasons: shared })
  }

  const prebuild = !nativeDirExists
    ? [`${platform}/ is missing`]
    : !cached
      ? ['no cached native fingerprint']
      : describe(diffFingerprints(cached.prebuild, next.prebuild))

  if (prebuild.length > 0) steps.push({ action: 'prebuild', reasons: prebuild })

  if (platform === 'ios') {
    const pods =
      prebuild.length > 0
        ? ['prebuild regenerates the Podfile']
        : !podsDirExists
          ? ['ios/Pods/ is missing']
          : describe(diffFingerprints(cached?.pods ?? {}, next.pods))

    if (pods.length > 0) steps.push({ action: 'pods', reasons: pods })
  }

  return steps
}

function readCache(platform: Platform): NativeState | null {
  const path = join(CACHE_DIR, `${platform}.json`)
  if (!existsSync(path)) return null

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as NativeState
  } catch {
    return null
  }
}

function writeCache(platform: Platform, state: NativeState) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(join(CACHE_DIR, `${platform}.json`), JSON.stringify(state, null, 2))
}

function readState(platform: Platform): NativeState {
  return {
    shared: sharedFingerprint(),
    prebuild: prebuildFingerprint(platform),
    pods: podsFingerprint(),
  }
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

  // `exitCode` is null when the child dies from a signal, and `process.exit(null)` exits 0 — which
  // would let the `&&` in `bun run ios` launch the app on a half-generated native project.
  if (!result.success) {
    const status = result.exitCode ?? `signal ${result.signalCode}`
    console.error(`\nnative-sync failed: ${command.join(' ')} exited with ${status}`)
    process.exit(result.exitCode ?? 1)
  }
}

function syncPlatform(platform: Platform) {
  // Android compiles these generated module resources directly. Keep them beside copy:shared's
  // generated assets, but never make an iOS sync perform Android-only work.
  if (platform === 'android') run(['bun', 'run', 'theme:android'])

  const steps = planSync({
    platform,
    nativeDirExists: existsSync(join(ROOT, platform)),
    podsDirExists: existsSync(join(ROOT, 'ios', 'Pods')),
    missingSharedOutputs: missingSharedOutputs(),
    cached: readCache(platform),
    next: readState(platform),
  })

  if (steps.length === 0) {
    console.log(`native-sync ${platform}: up to date`)
    return
  }

  const intents: Record<SyncAction, string> = {
    shared: 'copy:shared refreshes the generated Android assets',
    prebuild: 'expo prebuild regenerates the native project',
    pods: 'pod install refreshes the Pods project',
  }

  for (const { action, reasons } of steps) {
    console.log(`\nnative-sync ${platform}: ${intents[action]} because:`)
    for (const reason of reasons) {
      console.log(`  ${reason}`)
    }

    if (action === 'shared') {
      copyShared()
    } else if (action === 'prebuild') {
      run(['bunx', 'expo', 'prebuild', '--platform', platform])
    } else {
      // CocoaPods reads paths as ASCII-8BIT and crashes on `unicode_normalize` unless the locale is
      // UTF-8, which non-interactive shells often lack; Expo's own CLI pins LANG for the same reason.
      const lang = process.env.LANG ?? ''
      run(['pod', 'install'], {
        cwd: join(ROOT, 'ios'),
        env: { LANG: lang.toUpperCase().includes('UTF-8') ? lang : 'en_US.UTF-8' },
      })
    }
  }

  // Fingerprint the post-sync tree: prebuild can rewrite its own inputs (lockfile, package.json).
  writeCache(platform, readState(platform))
  console.log(`\nnative-sync ${platform}: synced`)
}

function main() {
  const requested = process.argv[2] as Platform | undefined
  if (requested && !PLATFORMS.includes(requested)) {
    console.error(`Usage: bun run scripts/native-sync.ts [${PLATFORMS.join('|')}]`)
    process.exit(1)
  }

  for (const platform of requested ? [requested] : PLATFORMS) syncPlatform(platform)
}

if (import.meta.main) {
  main()
}
