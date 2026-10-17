#!/usr/bin/env bun
import { mkdirSync } from 'fs'
import { join } from 'path'

import { PREVIEW_WARMUP_MS, REPLAY_WARMUP_SPEED } from '../src/config/replayWarmup.ts'

import { applicationId } from '../src/config/appVariant.ts'
import { maestroCommand } from './lib/maestro.ts'
import { createAndroidDriver } from './lib/androidCapture.ts'
import {
  capture,
  ROOT,
  runOrDie,
  type CaptureDriver,
  type CapturePlatform,
} from './lib/captureDriver.ts'
import { filmFeaturePreview } from './lib/featurePreview.ts'
import { createIosDriver } from './lib/iosCapture.ts'
import { PreviewRecording, exportPreview } from './lib/previewRecording.ts'
import { select } from './lib/select.ts'

let platform: CapturePlatform | 'both' | null = null
let device: string | null = null
let replay = 'replay-thor301.jsonl'
let noBuild = false
let scene = 'tour'
for (let i = 2; i < Bun.argv.length; i++) {
  const arg = Bun.argv[i]
  const value = () => {
    const next = Bun.argv[++i]
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    return next
  }
  if (arg === '--platform') {
    const next = value()
    if (!['android', 'ios', 'both'].includes(next)) throw new Error('Expected android, ios or both')
    platform = next as CapturePlatform | 'both'
  } else if (arg === '--device') device = value()
  else if (arg === '--replay') replay = value()
  else if (arg === '--no-build') noBuild = true
  else if (arg === '--scene') {
    scene = value()
    if (!['tour', 'ride', 'store', 'history', 'board-alerts'].includes(scene))
      throw new Error('Expected tour, ride, store, history or board-alerts')
  } else throw new Error(`Unknown argument: ${arg}`)
}
if (device && (!platform || platform === 'both'))
  throw new Error('--device requires a single --platform')
platform ??= await select('Preview platform', [
  { label: 'iOS', value: 'ios' as const, hint: 'Promo and App Store cuts' },
  { label: 'Android', value: 'android' as const, hint: 'Raw promo footage' },
  { label: 'Both', value: 'both' as const },
])

async function film(driver: CaptureDriver): Promise<void> {
  const outDir = join(ROOT, 'previews', driver.platform, scene)
  mkdirSync(outDir, { recursive: true })
  console.log(`› ${driver.deviceLabel}`)
  if (noBuild) {
    await driver.requireInstalled()
    console.log('› --no-build requires a preview build from this workspace.')
  } else await driver.buildAndInstall()
  await driver.requireAwakeDisplay()
  await driver.stageFixtures()
  await driver.pinLocation()
  const adb = (...args: string[]) => ['adb', '-s', driver.deviceId, ...args]
  const oldTouches =
    driver.platform === 'android'
      ? (await capture(adb('shell', 'settings', 'get', 'system', 'show_touches'))).trim()
      : null
  const appearanceCommand = (...args: string[]) =>
    driver.platform === 'ios'
      ? ['xcrun', 'simctl', 'ui', driver.deviceId, 'appearance', ...args]
      : adb('shell', 'cmd', 'uimode', 'night', ...args)
  const appearance = (await capture(appearanceCommand())).trim()
  const oldAppearance =
    driver.platform === 'ios' ? appearance : /^Night mode: (\w+)$/.exec(appearance)?.[1]
  if (!oldAppearance) throw new Error(`Could not read device appearance: ${appearance}`)
  const recording = new PreviewRecording(driver, outDir)
  let failure: unknown = null
  // Maestro's JS HTTP client runs on the host. Start only after its driver, launch and fixture
  // restore are ready; otherwise XCTest startup alone adds tens of seconds of dead footage.
  const token = crypto.randomUUID()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.searchParams.get('token') !== token || req.method !== 'POST')
        return new Response(null, { status: 403 })
      try {
        if (url.pathname === '/start') await recording.start()
        else if (url.pathname === '/stop') await recording.stop()
        else if (url.pathname === '/dwell') {
          const ms = Number(url.searchParams.get('ms'))
          if (!Number.isFinite(ms) || ms < 0 || ms > 30_000) throw new Error('Invalid dwell')
          await Bun.sleep(ms)
        } else return new Response(null, { status: 404 })
        return new Response('ok')
      } catch (error) {
        failure = error
        return new Response(String(error), { status: 500 })
      }
    },
  })
  const cancellation = new AbortController()
  const cancel = () => cancellation.abort()
  process.on('SIGINT', cancel)
  process.on('SIGTERM', cancel)
  try {
    // Native adaptive surfaces and the keyboard must also be dark throughout the take.
    await runOrDie(appearanceCommand(driver.platform === 'ios' ? 'dark' : 'yes'))
    await driver.setChrome(true)
    if (oldTouches != null)
      await runOrDie(adb('shell', 'settings', 'put', 'system', 'show_touches', '1'))
    if (scene === 'history' || scene === 'board-alerts') {
      await filmFeaturePreview(driver, scene, recording, cancellation.signal)
    } else {
      await runOrDie(
        await maestroCommand(
          '--device',
          driver.deviceId,
          'test',
          '-e',
          `APP_ID=${applicationId}`,
          '-e',
          `RECORDER_URL=http://127.0.0.1:${server.port}`,
          '-e',
          `RECORDER_TOKEN=${token}`,
          '-e',
          `WARMUP_WAIT_MS=${Math.ceil(PREVIEW_WARMUP_MS / REPLAY_WARMUP_SPEED) + 2000}`,
          join(ROOT, 'e2e', 'flows', 'preview', `${scene}.yaml`),
        ),
        undefined,
        360_000,
        cancellation.signal,
      )
    }
    if (failure) throw failure
  } finally {
    try {
      await recording.stop()
    } finally {
      server.stop(true)
      try {
        await driver.setChrome(false)
      } finally {
        try {
          if (oldTouches != null)
            await runOrDie(
              adb(
                'shell',
                'settings',
                oldTouches === 'null' ? 'delete' : 'put',
                'system',
                'show_touches',
                ...(oldTouches === 'null' ? [] : [oldTouches]),
              ),
            )
        } finally {
          try {
            await runOrDie(appearanceCommand(oldAppearance))
          } finally {
            process.off('SIGINT', cancel)
            process.off('SIGTERM', cancel)
          }
        }
      }
    }
  }
  const exports = await exportPreview(recording.rawPath, driver.platform, scene === 'store')
  const output = exports.appPreview ?? exports.web
  const probe = Bun.spawn(
    [
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      output,
    ],
    { stdout: 'pipe' },
  )
  const duration = Number(await new Response(probe.stdout).text())
  if ((await probe.exited) !== 0 || !Number.isFinite(duration))
    throw new Error('Could not verify video duration')
  console.log(
    `› Footage: ${recording.rawPath}\n› Web: ${exports.web} (${duration.toFixed(1)}s)${exports.appPreview ? `\n› App preview: ${exports.appPreview}` : ''}`,
  )
  if (driver.platform === 'ios' && scene === 'store' && (duration < 15 || duration > 30)) {
    throw new Error(
      `Take is ${duration.toFixed(1)}s, outside App Store's 15–30s range. Raw footage and export retained; adjust flow pacing.`,
    )
  }
}
for (const target of platform === 'both' ? (['ios', 'android'] as const) : [platform]) {
  const driver =
    target === 'ios'
      ? await createIosDriver(device, replay, 'preview')
      : await createAndroidDriver(device, replay, 'preview')
  await film(driver)
}
