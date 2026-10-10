import { expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { fixtureBuildEnv, type CaptureDriver } from './captureDriver.ts'
import { PreviewRecording } from './previewRecording.ts'

test('preview environment selects only native replay, even with ambient fixture flags', () => {
  const keys = [
    'EXPO_PUBLIC_E2E',
    'EXPO_PUBLIC_SCREENSHOTS',
    'EXPO_PUBLIC_SMOKE',
    'EXPO_PUBLIC_PREVIEW',
  ]
  const original = keys.map((key) => process.env[key])
  try {
    for (const key of keys) process.env[key] = '1'
    for (const mode of ['preview', 'smoke', 'screenshots'] as const) {
      const env = fixtureBuildEnv(mode, 'city.jsonl')
      expect(env.EXPO_PUBLIC_E2E).toBeUndefined()
      expect(env.EXPO_PUBLIC_FIXTURE_REPLAY).toBe('city.jsonl')
      expect(keys.slice(1).filter((key) => env[key] === '1')).toEqual([
        mode === 'preview'
          ? 'EXPO_PUBLIC_PREVIEW'
          : mode === 'smoke'
            ? 'EXPO_PUBLIC_SMOKE'
            : 'EXPO_PUBLIC_SCREENSHOTS',
      ])
    }
  } finally {
    keys.forEach((key, i) => {
      if (original[i] == null) delete process.env[key]
      else process.env[key] = original[i]
    })
  }
})

test('recorder waits for readiness and finalizes exactly once through SIGINT', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'preview-recorder-'))
  const originalPath = process.env.PATH
  try {
    const executable = join(dir, 'xcrun')
    writeFileSync(
      executable,
      `#!${process.execPath}\nconst file = process.argv.at(-1);\nprocess.on('SIGINT', async () => { await Bun.write(file, 'finalized video'); process.exit(0) });\nconsole.error('Recording started');\nsetInterval(() => {}, 1000);\n`,
    )
    chmodSync(executable, 0o755)
    process.env.PATH = `${dir}:${originalPath}`
    const recording = new PreviewRecording(
      { platform: 'ios', deviceId: 'test' } as CaptureDriver,
      dir,
    )
    await recording.start()
    await recording.stop()
    await recording.stop()
    expect(readFileSync(recording.rawPath, 'utf8')).toBe('finalized video')
    await expect(recording.start()).rejects.toThrow('Recorder already used')
  } finally {
    process.env.PATH = originalPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an early recorder failure rejects startup instead of claiming a capture', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'preview-recorder-'))
  const originalPath = process.env.PATH
  try {
    const executable = join(dir, 'xcrun')
    writeFileSync(executable, '#!/bin/sh\necho "No device" >&2\nexit 1\n')
    chmodSync(executable, 0o755)
    process.env.PATH = `${dir}:${originalPath}`
    const recording = new PreviewRecording(
      { platform: 'ios', deviceId: 'test' } as CaptureDriver,
      dir,
    )
    await expect(recording.start()).rejects.toThrow('Recorder exited before ready')
    await expect(recording.stop()).rejects.toThrow('Recorder failed')
  } finally {
    process.env.PATH = originalPath
    rmSync(dir, { recursive: true, force: true })
  }
})
