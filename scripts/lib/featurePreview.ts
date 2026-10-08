import { applicationId } from '../../src/config/appVariant.ts'
import { PREVIEW_WARMUP_MS, REPLAY_WARMUP_SPEED } from '../../src/config/replayWarmup.ts'
import { ROOT, type CaptureDriver } from './captureDriver.ts'
import type { PreviewRecording } from './previewRecording.ts'

export type FeaturePreviewScene = 'history' | 'board-alerts'

/** These scenes need real two-pointer input, which Maestro's command set cannot express. */
export async function filmFeaturePreview(
  driver: CaptureDriver,
  scene: FeaturePreviewScene,
  recording: PreviewRecording,
  signal: AbortSignal,
): Promise<void> {
  const session = `preview-${driver.platform}-${crypto.randomUUID()}`
  const device = driver.platform === 'ios' ? '--udid' : '--serial'
  async function command(...args: string[]): Promise<string> {
    console.log(`› ${args.slice(0, 3).join(' ')}`)
    const proc = Bun.spawn(['bunx', 'agent-device@0.21.23', ...args, '--session', session], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 90_000,
      killSignal: 'SIGKILL',
      signal,
    })
    const [out, error, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) throw new Error(`Device command failed: ${args.join(' ')}\n${error}\n${out}`)
    return out
  }
  const wait = (id: string) => command('wait', `id="${id}"`, '15000')
  const press = async (id: string) => {
    await wait(id)
    await command('press', `id="${id}"`)
  }
  const dwell = (ms: number) => command('wait', String(ms))
  async function rect(id: string) {
    const output = JSON.parse(await command('get', 'attrs', `id="${id}"`, '--json'))
    const bounds = output.data?.node?.rect as
      | { x: number; y: number; width: number; height: number }
      | undefined
    if (!bounds || bounds.width <= 0 || bounds.height <= 0)
      throw new Error(`No visible bounds for ${id}`)
    return bounds
  }
  async function zoom(id: string, scale: number) {
    const bounds = await rect(id)
    await command(
      'gesture',
      'pinch',
      String(scale),
      String(bounds.x + bounds.width / 2),
      String(bounds.y + bounds.height / 2),
    )
    await command('snapshot', '-i')
  }
  try {
    await command(
      'open',
      applicationId,
      '--platform',
      driver.platform,
      device,
      driver.deviceId,
      '--foreground',
    )
    await wait('battery-bar')
    await dwell(Math.ceil(PREVIEW_WARMUP_MS / REPLAY_WARMUP_SPEED) + 2000)
    // The Android emulator needs additional time to drain native replay and map rendering work.
    if (driver.platform === 'android') {
      for (let i = 0; i < 3; i++) await dwell(30_000)
    }
    await wait('floating-bar-record')
    if (scene === 'history') {
      await press('history-button')
      await wait('history-latest-ride')
    }
    await recording.start()
    await dwell(3000)
    if (scene === 'history') {
      await press('history-latest-ride')
      await wait('history-metric-tab-duty')
      await dwell(3000)
      await press('history-metric-tab-duty')
      await dwell(2000)
      await press('history-metric-tab-tempMotor')
      await wait('chart-row-tempMotor')
      await dwell(3000)
      await zoom('chart-row-speed', 3)
      await dwell(4000)
      const plot = await rect('chart-row-speed')
      await command(
        'gesture',
        'pan',
        String(plot.x + plot.width * 0.35),
        String(plot.y + plot.height / 2),
        String(plot.width * 0.3),
        '0',
        '1200',
      )
      await dwell(3000)
      await press('history-open-charts')
      await wait('history-charts-stack')
      await dwell(4000)
      await zoom('history-charts-stack', 2)
      await dwell(4000)
      await press('history-charts-close')
      await press('history-favorite-ride')
      await wait('trim-save')
      await dwell(3000)
      await command('fill', 'id="trim-favorite-name"', 'Kozanów loop')
      await dwell(1500)
      await command('keyboard', 'enter')
      await wait('favorite-edit')
      await dwell(5000)
    } else {
      await press('gauge-speed')
      await wait('alert-level-speed-safe')
      await dwell(3000)
      for (const level of ['safe', 'minimal', 'normal']) {
        await press(`alert-level-speed-${level}`)
        await dwell(4000)
      }
      await press('header-back')
      await wait('battery-bar')
      await press('gauge-duty')
      await wait('alert-level-duty-safe')
      await press('alert-level-duty-safe')
      await dwell(4000)
      await press('alert-level-duty-normal')
      await dwell(3000)
      await press('header-back')
      await press('telemetry-panel-handle')
      await wait('telemetry-list-speed')
      await dwell(6000)
      await command('scroll', 'down', '0.5', '--until', 'id="telemetry-list-imu"')
      await dwell(4000)
      await command('press', 'label="Pitch, Roll" role="button"')
      await command('wait', 'text', 'IMU', '15000')
      await dwell(10_000)
    }
  } finally {
    try {
      await recording.stop()
    } finally {
      // Cleanup must run even when a gesture fails or the command's AbortSignal is cancelled.
      const cleanup = Bun.spawn(['bunx', 'agent-device@0.21.23', 'close', '--session', session], {
        cwd: ROOT,
        stdout: 'ignore',
        stderr: 'inherit',
        timeout: 20_000,
        killSignal: 'SIGKILL',
      })
      const code = await cleanup.exited
      if (code !== 0) throw new Error(`Could not close device automation session ${session}`)
    }
  }
}
