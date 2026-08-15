import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { extname, join, parse, relative } from 'path'

const ROOT = join(import.meta.dir, '..')

export interface SharedTarget {
  src: string
  dest: string
  extensions: Set<string>
  rename: (file: string) => string
}

/**
 * Shared assets have exactly one source of truth: `shared/`. iOS reads single files through symlinks
 * committed under `modules/vescape-core/ios/`; everything else needs real copies — Gradle cannot
 * follow a symlink out of the module, and CocoaPods does not expand a glob through a symlinked
 * directory. These copies are generated, gitignored, and refreshed by `copyShared()`.
 */
export function sharedTargets(root = ROOT): SharedTarget[] {
  const androidSrc = join(root, 'modules', 'vescape-core', 'android', 'src')

  return [
    {
      src: join(root, 'shared', 'alerts'),
      dest: join(androidSrc, 'main', 'res', 'raw'),
      extensions: new Set(['.ogg', '.wav']),
      rename: (file: string) =>
        `${parse(file).name}${extname(file)}`.toLowerCase().replace(/[^a-z0-9_.]/g, '_'),
    },
    {
      src: join(root, 'shared', 'data'),
      dest: join(androidSrc, 'main', 'assets', 'data'),
      extensions: new Set(['.json']),
      rename: (file: string) => file,
    },
    {
      src: join(root, 'shared', 'data'),
      dest: join(androidSrc, 'test', 'resources', 'data'),
      extensions: new Set(['.json']),
      rename: (file: string) => file,
    },
    // Replay fixtures (Debug Recordings): test resources for the CI harness, plus app assets so
    // the dev-mode Replay UI can play bundled fixtures on-device (dev-only shipping, #230).
    {
      src: join(root, 'shared', 'fixtures'),
      dest: join(androidSrc, 'test', 'resources', 'fixtures'),
      extensions: new Set(['.jsonl']),
      rename: (file: string) => file,
    },
    {
      src: join(root, 'shared', 'fixtures'),
      dest: join(androidSrc, 'main', 'assets', 'fixtures'),
      extensions: new Set(['.jsonl']),
      rename: (file: string) => file,
    },
    // iOS needs real copies here too. A symlinked *file* under the pod root (`cell-presets.json`)
    // is resolved by CocoaPods, but a symlinked *directory* is not: `fixtures/*.jsonl` expanded to
    // nothing at `pod install`, so `VescapeCoreAssets.bundle` shipped without a single recording
    // and `startDebugReplay` had no fixture to play on a fresh install.
    {
      src: join(root, 'shared', 'fixtures'),
      dest: join(root, 'modules', 'vescape-core', 'ios', 'fixtures'),
      extensions: new Set(['.jsonl']),
      rename: (file: string) => file,
    },
  ]
}

/** Source files a target copies, absolute, sorted. */
export function sharedSources(target: SharedTarget): string[] {
  if (!existsSync(target.src)) return []
  return readdirSync(target.src)
    .filter((file) => target.extensions.has(extname(file).toLowerCase()))
    .sort()
    .map((file) => join(target.src, file))
}

/** Where a source file lands once copied. */
export function sharedOutput(target: SharedTarget, source: string): string {
  return join(target.dest, target.rename(parse(source).base))
}

export function copyShared(root = ROOT, { quiet = false } = {}) {
  const log = (line: string) => {
    if (!quiet) console.log(line)
  }
  let totalCopied = 0

  for (const target of sharedTargets(root)) {
    mkdirSync(target.dest, { recursive: true })

    log(`\n  ${relative(root, target.src)} → ${relative(root, target.dest)}`)

    // Copying alone leaves orphans behind: a fixture renamed in `shared/` kept shipping under its
    // old name inside the Android APK for a week, and showed up in the Replay UI as a recording
    // that no longer existed in the repo. Only names this target would produce survive, so a
    // destination it shares with anything else is left alone.
    const expected = new Set(
      sharedSources(target).map((source) => parse(sharedOutput(target, source)).base),
    )
    for (const file of readdirSync(target.dest)) {
      if (!target.extensions.has(extname(file).toLowerCase()) || expected.has(file)) continue
      rmSync(join(target.dest, file))
      log(`    ✗ ${file} (removed, no longer in ${relative(root, target.src)})`)
    }

    for (const source of sharedSources(target)) {
      const output = sharedOutput(target, source)
      copyFileSync(source, output)

      const file = parse(source).base
      const outputName = parse(output).base
      const renamed = outputName !== file ? ` (→ ${outputName})` : ''
      log(`    ✓ ${file}${renamed}`)
      totalCopied += 1
    }
  }

  if (totalCopied === 0) {
    throw new Error('No shared files found to copy')
  }

  log(`\n✓ ${totalCopied} file${totalCopied !== 1 ? 's' : ''} copied`)
  return totalCopied
}

if (import.meta.main) {
  copyShared()
}
