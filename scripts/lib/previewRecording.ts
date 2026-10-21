import { existsSync, statSync } from 'fs'
import { join } from 'path'

import { ROOT, runOrDie, type CaptureDriver } from './captureDriver.ts'

/** Own exactly one platform recorder. Android signals its remote PID, never every screenrecord. */
export class PreviewRecording {
  private process: ReturnType<typeof Bun.spawn> | null = null
  private remotePid: string | null = null
  private remotePath: string
  private stopped = false
  readonly rawPath: string

  constructor(
    private driver: CaptureDriver,
    outDir: string,
  ) {
    const name = `preview-${Date.now()}`
    this.remotePath = `/sdcard/${name}.mp4`
    this.rawPath = join(outDir, `${name}-raw.${driver.platform === 'ios' ? 'mov' : 'mp4'}`)
  }

  async start(): Promise<void> {
    if (this.process || this.stopped) throw new Error('Recorder already used')
    const { platform, deviceId } = this.driver
    const cmd =
      platform === 'ios'
        ? ['xcrun', 'simctl', 'io', deviceId, 'recordVideo', '--codec=h264', this.rawPath]
        : [
            'adb',
            '-s',
            deviceId,
            'shell',
            `echo $$; exec screenrecord --bit-rate 16000000 --time-limit 180 ${this.remotePath}`,
          ]
    const proc = Bun.spawn(cmd, {
      cwd: ROOT,
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    this.process = proc
    const ready = async () => {
      const stream = platform === 'ios' ? proc.stderr : proc.stdout
      const reader = stream.getReader()
      let output = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) throw new Error(`Recorder exited before ready: ${output}`)
          output += new TextDecoder().decode(value)
          if (platform === 'ios' && output.includes('Recording started')) return
          if (platform === 'android') {
            const pid = /^\s*(\d+)\r?\n/.exec(output)?.[1]
            if (pid) {
              this.remotePid = pid
              await Bun.sleep(500)
              if (proc.exitCode != null) throw new Error('Android screenrecord failed')
              return
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        ready(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Recorder did not start within 15s')), 15_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  async stop(): Promise<void> {
    if (!this.process || this.stopped) return
    this.stopped = true
    const proc = this.process
    if (proc.exitCode == null && this.driver.platform === 'android' && this.remotePid) {
      try {
        await runOrDie(
          ['adb', '-s', this.driver.deviceId, 'shell', 'kill', '-2', this.remotePid],
          undefined,
          5000,
        )
      } catch (error) {
        proc.kill('SIGKILL')
        await proc.exited
        throw error
      }
    } else if (proc.exitCode == null) {
      proc.kill('SIGINT')
    }
    const timer = setTimeout(() => proc.kill('SIGKILL'), 15_000)
    const code = await proc.exited
    clearTimeout(timer)
    if (code !== 0) throw new Error(`Recorder failed (${code}); partial footage: ${this.rawPath}`)
    if (this.driver.platform === 'android') {
      await runOrDie(
        ['adb', '-s', this.driver.deviceId, 'pull', this.remotePath, this.rawPath],
        undefined,
        30_000,
      )
      await runOrDie(['adb', '-s', this.driver.deviceId, 'shell', 'rm', '-f', this.remotePath])
    }
    if (!existsSync(this.rawPath) || statSync(this.rawPath).size === 0)
      throw new Error('Recorder produced no footage')
  }
}

export async function exportPreview(
  rawPath: string,
  platform: CaptureDriver['platform'],
  appStore = true,
): Promise<{ web: string; appPreview: string | null }> {
  const stem = rawPath.replace(/-raw\.(mov|mp4)$/, '')
  const web = `${stem}-web.mp4`
  const appPreview = platform === 'ios' && appStore ? `${stem}-app-preview.mp4` : null
  // Preserve the complete take and its timing. Keep the original for later editing.
  if (appPreview) {
    await runOrDie([
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      rawPath,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-vf',
      'scale=886:1920:force_original_aspect_ratio=decrease,pad=886:1920:(ow-iw)/2:(oh-ih)/2,fps=30',
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-level:v',
      '4.0',
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      '11M',
      '-maxrate',
      '12M',
      '-bufsize',
      '24M',
      '-c:a',
      'aac',
      '-b:a',
      '256k',
      '-shortest',
      '-movflags',
      '+faststart',
      appPreview,
    ])
  }
  await runOrDie([
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    rawPath,
    '-vf',
    'scale=720:-2,fps=30',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '23',
    '-an',
    '-movflags',
    '+faststart',
    web,
  ])
  return { web, appPreview }
}
