import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { Fingerprint } from '@expo/fingerprint'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { createIosSmokeFingerprint } from './iosSmokeFingerprint.ts'

let root: string
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
)
const nativeFiles = [
  'modules/vescape-core/ios/Module.swift',
  'modules/vescape-core/shared/alert-preset-definitions.json',
  'targets/ride-activity/Widget.swift',
  'watch/watchos/WatchApp.swift',
  'shared/alerts/on.wav',
  'shared/fixtures/replay.jsonl',
  'assets/fonts/watch.ttf',
  'plugins/withNativeConfig.ts',
  'patches/native.patch',
  'bun.lock',
  'clerk-theme.json',
  'scripts/lib/fixtureBuild.ts',
  'scripts/native-sync.ts',
]

function write(path: string, contents: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), contents)
}

function git(...args: string[]) {
  const result = Bun.spawnSync(['git', '-C', root, ...args], { env: gitEnv })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function expoFingerprint(): Fingerprint {
  return {
    hash: 'complete-expo-hash',
    sources: [
      ...[
        'expoConfig',
        'expoAutolinkingConfig:ios',
        'rncoreAutolinkingConfig:ios',
        'package:react-native',
      ].map((id) => ({
        type: 'contents' as const,
        id,
        contents: '{}',
        reasons: [],
        hash: 'present',
      })),
      { type: 'dir', filePath: 'modules/vescape-core/ios', reasons: [], hash: 'present' },
    ],
  }
}

function fingerprint(env: Record<string, string | undefined> = {}, expo = expoFingerprint()) {
  return createIosSmokeFingerprint(root, { env, fingerprint: async () => expo })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ios-smoke-fingerprint-'))
  git('init', '--quiet')
  write('package.json', '{"dependencies":{"expo":"57.0.24"}}')
  for (const path of nativeFiles) write(path, 'native input')
  write('src/screens/Home.tsx', 'export default () => null')
  git('add', '.')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

test('ordinary JS changes and generated native projects preserve the native fingerprint', async () => {
  const before = await fingerprint()
  write('src/screens/Home.tsx', 'export default () => "changed screen"')
  write('ios/Generated.xcodeproj/project.pbxproj', 'generated build state')
  write('android/app/build.gradle', 'generated build state')
  expect(await fingerprint()).toBe(before)
})

test('native content, dependencies, plugin inputs, and build recipes invalidate reuse', async () => {
  const before = await fingerprint()
  for (const file of nativeFiles) {
    write(file, 'changed native input')
    expect(await fingerprint()).not.toBe(before)
    write(file, 'native input')
  }
  write('package.json', '{"dependencies":{"expo":"57.0.25"}}')
  expect(await fingerprint()).not.toBe(before)
})

test('added and deleted native sources change the fingerprint', async () => {
  const before = await fingerprint()
  write('modules/vescape-core/ios/New.swift', 'new source')
  git('add', '.')
  expect(await fingerprint()).not.toBe(before)
  git('rm', '--cached', 'modules/vescape-core/ios/New.swift')
  expect(await fingerprint()).toBe(before)
  git('rm', '--cached', nativeFiles[0]!)
  expect(await fingerprint()).not.toBe(before)
})

test('native symlinks include their destination and canonical contents', async () => {
  write('source/first.ttf', 'font')
  write('source/second.ttf', 'font')
  const link = join(root, 'watch/watchos/font.ttf')
  symlinkSync('../../source/first.ttf', link)
  git('add', '.')
  const before = await fingerprint()
  write('source/first.ttf', 'changed font')
  expect(await fingerprint()).not.toBe(before)
  write('source/first.ttf', 'font')
  rmSync(link)
  symlinkSync('../../source/second.ttf', link)
  expect(await fingerprint()).not.toBe(before)
})

test('native environment changes invalidate reuse while CI bookkeeping does not', async () => {
  const before = await fingerprint({ EXPO_PUBLIC_SERVER_URL: 'https://first.example' })
  expect(await fingerprint({ EXPO_PUBLIC_SERVER_URL: 'https://second.example' })).not.toBe(before)
  expect(
    await fingerprint({ EXPO_PUBLIC_SERVER_URL: 'https://first.example', GITHUB_SHA: 'next' }),
  ).toBe(before)
  expect(
    await fingerprint({ EXPO_PUBLIC_SERVER_URL: 'https://first.example', EXPO_PUBLIC_SMOKE: '1' }),
  ).not.toBe(before)
})

test('partial Expo discovery cannot authorize a cached binary', async () => {
  const complete = expoFingerprint()
  for (let i = 0; i < complete.sources.length; i++) {
    const incomplete = { ...complete, sources: complete.sources.filter((_, index) => index !== i) }
    await expect(fingerprint({}, incomplete)).rejects.toThrow('Incomplete iOS fingerprint')
  }
  await expect(
    fingerprint({}, { ...complete, sources: complete.sources.map((s) => ({ ...s, hash: null })) }),
  ).rejects.toThrow('Incomplete iOS fingerprint')
})

test('new app-level codegen fails closed until its JS native inputs are covered', async () => {
  write('package.json', '{"codegenConfig":{"name":"AppSpec","jsSrcsDir":"src/specs"}}')
  await expect(fingerprint()).rejects.toThrow('App-level codegen')
})
