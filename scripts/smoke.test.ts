import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'

import type { CaptureDriver } from './lib/captureDriver.ts'
import { main, readArgs, selectFlows } from './smoke.ts'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'smoke-artifact-test-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const unexpected = async (): Promise<never> => {
  throw new Error('Must not build or boot a device here')
}

test('build-only exports an APK without resolving or booting a device', async () => {
  const artifact = join(root, 'built.apk')
  const output = join(root, 'output', 'app.apk')
  writeFileSync(artifact, 'release APK')
  const args = readArgs(['--build-only', '--output', output])
  await main(args, {
    buildApp: async (received) => {
      expect(received.platform).toBe('android')
      expect(received.replay).toBe('replay-thor301.jsonl')
      return artifact
    },
    createDriver: unexpected,
    runFlow: unexpected,
  })
  expect(readFileSync(output, 'utf8')).toBe('release APK')
})

test('iOS artifact export preserves executable bits and relative bundle symlinks', async () => {
  const artifact = join(root, 'built.app')
  const output = join(root, 'output', 'vescape.app')
  mkdirSync(artifact)
  writeFileSync(join(artifact, 'binary'), 'executable')
  chmodSync(join(artifact, 'binary'), 0o755)
  symlinkSync('binary', join(artifact, 'linked-binary'))
  await main(readArgs(['--platform', 'ios', '--build-only', '--output', output]), {
    buildApp: async () => artifact,
    createDriver: unexpected,
    runFlow: unexpected,
  })
  expect(statSync(join(output, 'binary')).mode & 0o777).toBe(0o755)
  expect(readlinkSync(join(output, 'linked-binary'))).toBe('binary')
})

test('each artifact flow installs once and starts a fresh fixture session without compiling', async () => {
  for (const flow of selectFlows(null)) {
    const calls: string[] = []
    const app = join(root, 'app.apk')
    const driver: CaptureDriver = {
      platform: 'android',
      outDir: '',
      deviceId: 'emulator-test',
      deviceLabel: 'test',
      buildAndInstall: unexpected,
      requireInstalled: unexpected,
      installArtifact: async (path) => {
        expect(path).toBe(app)
        calls.push('install')
      },
      requireAwakeDisplay: async () => {
        calls.push('awake')
      },
      stageFixtures: async () => {
        calls.push('fixtures')
      },
      pinLocation: async () => {
        calls.push('location')
      },
      setChrome: unexpected,
    }
    await main(readArgs(['--app', app, '--flow', flow]), {
      buildApp: unexpected,
      createDriver: async () => driver,
      runFlow: async (path, selected) => {
        expect(selected).toBe(driver)
        calls.push(basename(path))
      },
    })
    expect(calls).toEqual(['install', 'awake', 'fixtures', 'location', '_boot.yaml', flow])
  }
})

test('unknown selected flows fail before building or acquiring a device', async () => {
  await expect(
    main(readArgs(['--flow', '../fixture/_boot']), {
      buildApp: unexpected,
      createDriver: unexpected,
      runFlow: unexpected,
    }),
  ).rejects.toThrow('No smoke flow named')
})
