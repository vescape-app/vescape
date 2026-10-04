import { repackAppIosAsync, type SpawnProcessAsync } from '@expo/repack-app'
import spawnAsync from '@expo/spawn-async'
import { createHash } from 'crypto'
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { join, resolve } from 'path'

import { fixtureBuildEnv, ROOT, runOrDie } from './lib/captureDriver.ts'
import { createIosSmokeFingerprint } from './lib/iosSmokeFingerprint.ts'
import { DEFAULT_REPLAY } from './smoke.ts'

const OUTPUT = join(ROOT, '.expo/smoke/vescape.app')
const CACHE = join(ROOT, '.expo/smoke/ios-native-base')
const ARCHIVE = join(CACHE, 'app.tar.gz')
const METADATA = join(CACHE, 'metadata.json')

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Expo's process hook keeps all package/script execution on the repository's Bun toolchain. */
export const spawnWithBun: SpawnProcessAsync = (command, args, options) =>
  command === 'npx'
    ? spawnAsync('bun', ['run', ...args], options)
    : spawnAsync(command, args, options)

// repack-app 0.10.4's directory copier skips symlinks. Restore their original targets after its
// JS-only update so versioned frameworks remain complete. Native files must not be replaced.
export function preserveBundleLinks(source: string, output: string): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(output, entry.name)
    if (entry.isDirectory()) preserveBundleLinks(from, to)
    else if (entry.isSymbolicLink()) {
      mkdirSync(resolve(to, '..'), { recursive: true })
      if (lstatSync(to, { throwIfNoEntry: false })) {
        if (readlinkSync(to) !== readlinkSync(from)) throw new Error(`Changed bundle link: ${to}`)
      } else symlinkSync(readlinkSync(from), to)
    }
  }
}

async function executable(app: string): Promise<string> {
  const { stdout } = await spawnAsync('plutil', [
    '-extract',
    'CFBundleExecutable',
    'raw',
    '-o',
    '-',
    join(app, 'Info.plist'),
  ])
  return join(app, stdout.trim())
}

function requireFingerprint(value: string | undefined): string {
  if (!value || !/^[a-f0-9]{40,64}$/.test(value)) throw new Error('Missing native fingerprint.')
  return value
}

async function main() {
  const [command, hash] = process.argv.slice(2)
  const env = fixtureBuildEnv('smoke', DEFAULT_REPLAY)
  // Expo config and autolinking load process.env in addition to the child-process environment.
  delete process.env.EXPO_PUBLIC_E2E
  delete process.env.EXPO_PUBLIC_SCREENSHOTS
  Object.assign(process.env, env)

  if (command === 'fingerprint') {
    const fingerprint = await createIosSmokeFingerprint(ROOT)
    console.log(`iOS native fingerprint: ${fingerprint}`)
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `hash=${fingerprint}\n`)
    return
  }
  const fingerprint = requireFingerprint(hash)
  if (command === 'record') {
    mkdirSync(CACHE, { recursive: true })
    await runOrDie(['tar', '-czf', ARCHIVE, '-C', resolve(OUTPUT, '..'), 'vescape.app'])
    writeFileSync(
      METADATA,
      JSON.stringify(
        {
          fingerprint,
          executableHash: sha256(await executable(OUTPUT)),
          archiveHash: sha256(ARCHIVE),
          sourceRevision: process.env.GITHUB_SHA ?? null,
        },
        null,
        2,
      ),
    )
    return
  }
  if (command !== 'repack') throw new Error(`Unknown command: ${command}`)

  const metadata = JSON.parse(readFileSync(METADATA, 'utf8'))
  if (metadata.fingerprint !== fingerprint || metadata.archiveHash !== sha256(ARCHIVE)) {
    throw new Error('Cached native app does not match its fingerprint or archive checksum.')
  }
  const sourceDir = join(ROOT, '.expo/smoke/repack-source')
  rmSync(sourceDir, { recursive: true, force: true })
  mkdirSync(sourceDir, { recursive: true })
  await runOrDie(['tar', '-xzf', ARCHIVE, '-C', sourceDir])
  const source = join(sourceDir, 'vescape.app')
  if (sha256(await executable(source)) !== metadata.executableHash) {
    throw new Error('Cached native executable checksum does not match.')
  }
  rmSync(OUTPUT, { recursive: true, force: true })
  await repackAppIosAsync({
    platform: 'ios',
    projectRoot: ROOT,
    sourceAppPath: ARCHIVE,
    outputPath: OUTPUT,
    jsBundleOnly: true,
    exportEmbedOptions: {},
    env,
    spawnAsync: spawnWithBun,
  })
  preserveBundleLinks(source, OUTPUT)
  if (sha256(await executable(OUTPUT)) !== metadata.executableHash) {
    throw new Error('Repacking unexpectedly changed the native executable.')
  }

  // Resource changes invalidate the outer signature. Keep the simulator's original keychain and
  // application identifiers instead of using device distribution credentials.
  const { stdout: entitlements } = await spawnAsync('codesign', [
    '-d',
    '--entitlements',
    ':-',
    source,
  ])
  if (!entitlements.includes('<plist')) throw new Error('Cached app has no simulator entitlements.')
  const entitlementsFile = join(sourceDir, 'simulator.entitlements')
  writeFileSync(entitlementsFile, entitlements)
  await runOrDie(['codesign', '--force', '--sign', '-', '--entitlements', entitlementsFile, OUTPUT])
  await runOrDie(['codesign', '--verify', '--deep', '--strict', OUTPUT])
  console.log(`Repacked native build from ${metadata.sourceRevision}; native executable unchanged.`)
  console.log(
    `JavaScript SHA256: ${sha256(join(source, 'main.jsbundle'))} -> ${sha256(join(OUTPUT, 'main.jsbundle'))}`,
  )
  rmSync(sourceDir, { recursive: true, force: true })
}

if (import.meta.main) await main()
