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
import { listAdbDevices } from './lib/devices.ts'
import { createIosDriver } from './lib/iosCapture.ts'
import { PreviewRecording, PreviewTake, exportPreview } from './lib/previewRecording.ts'
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

/** Boots the Wear emulator, then builds and installs the current watch app; returns its serial. */
async function readyWatch(): Promise<string> {
  const findWatch = () => listAdbDevices().find((it) => it.isWatch && it.isEmulator)
  if (!findWatch()) await runOrDie(['bun', 'run', 'scripts/wear.ts', 'emulator'])
  const deadline = Date.now() + 5 * 60_000
  let watch = findWatch()
  while (
    !watch ||
    (
      await capture(['adb', '-s', watch.serial, 'shell', 'getprop', 'sys.boot_completed'])
    ).trim() !== '1'
  ) {
    if (Date.now() > deadline) throw new Error('The Wear emulator did not boot')
    await Bun.sleep(2000)
    watch = findWatch()
  }
  await runOrDie(
    ['bun', 'run', 'scripts/wear.ts', 'install', '--device', watch.serial],
    undefined,
    30 * 60_000,
  )
  return watch.serial
}

const MIRROR_ACTIVITY = 'app.vescape.wear.MainActivity'
/** Long enough for the restarted Mirror to draw its first replayed frame before footage starts. */
const WATCH_LAUNCH_MS = 2000

/**
 * Starts the wrist on `watch-preview.jsonl`, the phone's recording reduced to lanes on its real GPS
 * track, at the point the phone's replay has reached. No Data Layer: the emulators' pairing is not
 * reliable enough to film, so the wrist is fed what the phone would have sent it.
 */
async function startWatchReplay(watch: string, phone: string): Promise<void> {
  const log = await capture(['adb', '-s', phone, 'logcat', '-d', '-s', 'VescSession:D'])
  const startedAt = [...log.matchAll(/replay playback started .*wallMs=(\d+)/g)].at(-1)?.[1]
  if (!startedAt) throw new Error(`No replay playback start in ${phone} logcat`)
  // After its warmup the phone replays at 1x, trailing wall time by the warmup's real duration.
  const epoch = Number(startedAt) + PREVIEW_WARMUP_MS / REPLAY_WARMUP_SPEED - PREVIEW_WARMUP_MS
  await runOrDie([
    'adb',
    '-s',
    watch,
    'shell',
    'am',
    'start',
    '-S',
    '-n',
    `${applicationId}/${MIRROR_ACTIVITY}`,
    '--es',
    'replay',
    'preview',
    '--el',
    'replayEpoch',
    String(Math.round(epoch)),
  ])
  await Bun.sleep(WATCH_LAUNCH_MS)
}

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
  // Android takes always film the Wear emulator too, booting it when needed.
  const watch = driver.platform === 'android' ? await readyWatch() : null
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
  const phoneRecording = new PreviewRecording(driver, outDir)
  const watchRecording = watch
    ? new PreviewRecording({ platform: 'android', deviceId: watch }, outDir, 'watch')
    : null
  // The take starts only once the wrist replays from where the phone is, never on its idle screen.
  const recording = new PreviewTake(
    watchRecording ? [phoneRecording, watchRecording] : [phoneRecording],
    watch ? () => startWatchReplay(watch, driver.deviceId) : undefined,
  )
  const watchAdb = (...args: string[]) => ['adb', '-s', watch!, ...args]
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
    if (watch) {
      // Out of ambient mode for the whole take.
      await runOrDie(watchAdb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'))
      await runOrDie(watchAdb('shell', 'svc', 'power', 'stayon', 'true'))
    }
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
        if (watch) await runOrDie(watchAdb('shell', 'svc', 'power', 'stayon', 'false'))
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
  if (watchRecording) {
    const watchExports = await exportPreview(watchRecording.rawPath, 'android', false)
    console.log(`› Watch: ${watchRecording.rawPath}\n› Watch web: ${watchExports.web}`)
  }
  const exports = await exportPreview(phoneRecording.rawPath, driver.platform, scene === 'store')
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
    `› Footage: ${phoneRecording.rawPath}\n› Web: ${exports.web} (${duration.toFixed(1)}s)${exports.appPreview ? `\n› App preview: ${exports.appPreview}` : ''}`,
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
