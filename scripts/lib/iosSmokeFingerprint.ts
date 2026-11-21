import { createFingerprintAsync, type Fingerprint } from '@expo/fingerprint'
import { createHash } from 'crypto'
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'fs'
import { isAbsolute, join, relative } from 'path'

import { ROOT } from './captureDriver.ts'

const NATIVE_INPUTS = [
  'app.config.ts',
  'package.json',
  'bun.lock',
  'clerk-theme.json',
  'src/config/appVariant.ts',
  'src/helpers/version.ts',
  'plugins',
  'patches',
  'modules',
  'targets',
  'watch/watchos',
  'shared',
  'assets/images',
  'assets/fonts',
  'react-native.config.js',
  'react-native.config.ts',
]

const BUILD_INPUTS = [
  '.github/workflows/smoke.yml',
  'scripts/native-sync.ts',
  'scripts/copy-shared.ts',
  'scripts/smoke.ts',
  'scripts/ios-smoke-repack.ts',
  'scripts/lib/captureDriver.ts',
  'scripts/lib/fixtureBuild.ts',
  'scripts/lib/iosSmokeFingerprint.ts',
]

const NATIVE_ENV = [
  'APPLE_TEAM_ID',
  'VERSION_CODE',
  'EXPO_PUBLIC_VESCAPE_APP_VARIANT',
  'EXPO_PUBLIC_SERVER_URL',
  'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN',
  'EXPO_PUBLIC_MAPY_API_KEY',
  'EXPO_PUBLIC_SENTRY_DSN',
  'EXPO_PUBLIC_SMOKE',
  'EXPO_PUBLIC_SCREENSHOTS',
  'EXPO_PUBLIC_E2E',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'NODE_ENV',
  'BABEL_ENV',
  'RCT_NEW_ARCH_ENABLED',
  'RCT_USE_RN_DEP',
  'RCT_USE_PREBUILT_RNCORE',
  'USE_FRAMEWORKS',
  'EXPO_USE_COMMUNITY_AUTOLINKING',
  'EXPO_USE_PRECOMPILED_MODULES',
]

interface Dependencies {
  fingerprint: typeof createFingerprintAsync
  env: Record<string, string | undefined>
}

function requireCompleteExpoFingerprint(fingerprint: Fingerprint): void {
  if (!fingerprint.hash) throw new Error('Incomplete iOS fingerprint: project hash is missing.')
  for (const id of [
    'expoConfig',
    'expoAutolinkingConfig:ios',
    'rncoreAutolinkingConfig:ios',
    'package:react-native',
  ]) {
    if (
      !fingerprint.sources.some(
        (source) => source.type === 'contents' && source.id === id && source.hash,
      )
    )
      throw new Error(`Incomplete iOS fingerprint: missing ${id}.`)
  }
  if (
    !fingerprint.sources.some(
      (source) =>
        source.type === 'dir' && source.filePath === 'modules/vescape-core/ios' && source.hash,
    )
  )
    throw new Error('Incomplete iOS fingerprint: VescapeCore native sources are missing.')
}

function nativeInputs(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (pkg.codegenConfig) throw new Error('App-level codegen requires iOS fingerprint coverage.')

  const git = Bun.spawnSync(['git', '-C', root, 'ls-files', '-z'], {
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  })
  if (git.exitCode !== 0) throw new Error('Cannot enumerate tracked iOS fingerprint inputs.')
  const files = new Set(
    git.stdout
      .toString()
      .split('\0')
      .filter(
        (file) =>
          file.startsWith('.env') ||
          NATIVE_INPUTS.some((input) => file === input || file.startsWith(`${input}/`)),
      ),
  )
  BUILD_INPUTS.forEach((file) => files.add(file))
  const hash = createHash('sha256')
  const resolvedRoot = realpathSync(root)
  for (const file of [...files].sort()) {
    const path = join(root, file)
    hash.update(JSON.stringify(file))
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (!stat) {
      hash.update('missing')
      continue
    }
    if (stat.isSymbolicLink()) {
      hash.update(JSON.stringify(readlinkSync(path)))
      const target = relative(resolvedRoot, realpathSync(path))
      if (isAbsolute(target) || target === '..' || target.startsWith('../'))
        throw new Error(`Native symlink escapes the repository: ${file}`)
    }
    hash.update(createHash('sha256').update(readFileSync(path)).digest())
  }
  return hash.digest('hex')
}

export async function createIosSmokeFingerprint(
  root = ROOT,
  deps: Dependencies = { fingerprint: createFingerprintAsync, env: process.env },
): Promise<string> {
  const inputs = nativeInputs(root)
  const fingerprint = await deps.fingerprint(root, {
    platforms: ['ios'],
    hashAlgorithm: 'sha256',
    concurrentIoLimit: 4,
    ignorePaths: ['ios/**/*', 'android/**/*'],
  })
  requireCompleteExpoFingerprint(fingerprint)
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        platform: process.platform,
        arch: process.arch,
        fingerprint: fingerprint.hash,
        inputs,
        env: NATIVE_ENV.map((key) => [key, deps.env[key] ?? null]),
      }),
    )
    .digest('hex')
}
