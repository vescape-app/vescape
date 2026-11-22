import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import nodePath, { dirname, extname, join, parse } from 'path'

const ROOT = join(import.meta.dir, '..')

export interface SharedTarget {
  src: string
  dest: string
  extensions: Set<string>
  rename: (file: string) => string
  include?: (path: string) => boolean
}

const alertPacks = (path: string) =>
  (path.startsWith('effects-') || path.startsWith('voice-')) && path.includes('/')

export function sharedTargets(root = ROOT): SharedTarget[] {
  const androidSrc = join(root, 'modules', 'vescape-core', 'android', 'src')

  return [
    {
      src: join(root, 'shared', 'alerts', 'packs'),
      dest: join(androidSrc, 'main', 'assets', 'alert-packs'),
      extensions: new Set(['.json', '.m4a']),
      rename: (file: string) => file,
      include: alertPacks,
    },
    {
      src: join(root, 'shared', 'alerts', 'packs'),
      dest: join(root, 'modules', 'vescape-core', 'ios', 'alert-packs'),
      extensions: new Set(['.json', '.m4a']),
      rename: (file: string) => file,
      include: alertPacks,
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
    {
      src: join(root, 'shared', 'fixtures'),
      dest: join(root, 'modules', 'vescape-core', 'ios', 'fixtures'),
      extensions: new Set(['.jsonl']),
      rename: (file: string) => file,
    },
  ]
}

export function relativePath(from: string, to: string, { relative, sep } = nodePath): string {
  return relative(from, to).split(sep).join('/')
}

function listFiles(dir: string, recursive: boolean): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relativePath(dir, join(entry.parentPath, entry.name)))
}

export function sharedSources(target: SharedTarget): string[] {
  return listFiles(target.src, !!target.include)
    .filter((file) => target.extensions.has(extname(file).toLowerCase()))
    .filter((file) => !target.include || target.include(file))
    .sort()
    .map((file) => join(target.src, file))
}

export function sharedOutput(target: SharedTarget, source: string): string {
  const file = relativePath(target.src, source)
  return join(target.dest, dirname(file), target.rename(parse(file).base))
}

export function copyShared(root = ROOT, { quiet = false } = {}) {
  const log = (line: string) => {
    if (!quiet) console.log(line)
  }
  let totalCopied = 0

  for (const target of sharedTargets(root)) {
    mkdirSync(target.dest, { recursive: true })

    log(`\n  ${relativePath(root, target.src)} → ${relativePath(root, target.dest)}`)

    const expected = new Set(
      sharedSources(target).map((source) =>
        relativePath(target.dest, sharedOutput(target, source)),
      ),
    )
    for (const file of listFiles(target.dest, !!target.include)) {
      if (!target.extensions.has(extname(file).toLowerCase()) || expected.has(file)) continue
      rmSync(join(target.dest, file))
      log(`    ✗ ${file} (removed, no longer in ${relativePath(root, target.src)})`)
    }

    const sources = sharedSources(target)
    if (target.include && sources.length === 0) {
      throw new Error(`No files under ${relativePath(root, target.src)} passed its filter`)
    }

    for (const source of sources) {
      const output = sharedOutput(target, source)
      mkdirSync(dirname(output), { recursive: true })
      copyFileSync(source, output)

      const file = relativePath(target.src, source)
      const outputName = relativePath(target.dest, output)
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
