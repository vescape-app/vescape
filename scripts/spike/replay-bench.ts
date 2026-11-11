#!/usr/bin/env bun
/**
 * Spike #642: one replay benchmark run of the real main map on an Android device, with the render
 * thread numbers only adb can see.
 *
 *   bun scripts/spike/replay-bench.ts --out <dir> [-s <serial>] [--seconds 120] [--label name]
 *     [--package app.vescape.dev] [--metro http://10.0.2.2:8081] [--screenshot <png>]
 *
 * Cold-starts the dev client against Metro (emulator: 10.0.2.2; a phone gets `adb reverse` and
 * localhost), opens `vescape://dev/replay-bench`, resets `gfxinfo` on the first replayed fix, reads
 * SurfaceFlinger frame timing for the map surface shortly before the window ends, waits for the
 * `SPIKE_RESULT`, and writes the result with an `android` block added to `<dir>/<label>.json`.
 * The file is still a result JSON for `compare-runs.ts`.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parseArgs } from 'util'

import { parseLog } from './benchLog'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    out: { type: 'string' },
    serial: { type: 'string', short: 's' },
    seconds: { type: 'string', default: '120' },
    label: { type: 'string' },
    package: { type: 'string', default: 'app.vescape.dev' },
    metro: { type: 'string' },
    screenshot: { type: 'string' },
  },
})
if (!values.out) {
  console.error('usage: bun scripts/spike/replay-bench.ts --out <dir> [-s <serial>] [...]')
  process.exit(1)
}
const pkg = values.package!
const windowS = Number(values.seconds)

function run(cmd: string[], allowFail = false): string {
  const result = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0 && !allowFail) {
    throw new Error(`${cmd.join(' ')} failed: ${result.stderr.toString().trim()}`)
  }
  return result.stdout.toString()
}

const serial =
  values.serial ??
  run(['adb', 'devices'])
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t'))
    .find((cols) => cols[1] === 'device')?.[0]
if (!serial) throw new Error('no adb device')
const adb = (...args: string[]) => run(['adb', '-s', serial, ...args])
const shell = (command: string) => adb('shell', command)
const git = (...args: string[]) => run(['git', ...args]).trim()

const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
const commit = `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain', '--untracked-files=no') ? '-dirty' : ''}`
const emulator = serial.startsWith('emulator-')
const metro = values.metro ?? (emulator ? 'http://10.0.2.2:8081' : 'http://localhost:8081')
if (!emulator && !values.metro) adb('reverse', 'tcp:8081', 'tcp:8081')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const log = () => adb('logcat', '-d', '-v', 'brief', 'ReactNativeJS:V', '*:S')

async function waitForLog(match: (text: string) => boolean, timeoutMs: number, what: string) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const text = log()
    if (match(text)) return text
    await sleep(1000)
  }
  throw new Error(`timed out waiting for ${what}`)
}

const view = (url: string) => shell(`am start -a android.intent.action.VIEW -d '${url}' ${pkg}`)

// Fresh app on the current Metro bundle.
shell(`am force-stop ${pkg}`)
adb('logcat', '-c')
view(`vescape://expo-development-client/?url=${encodeURIComponent(metro)}`)
await waitForLog((t) => t.includes('Running "main"'), 180_000, 'the JS bundle to start')
await sleep(8000)

adb('logcat', '-c')
const params = new URLSearchParams({ seconds: String(windowS), branch, commit })
view(`vescape://dev/replay-bench?${params.toString()}`)
await waitForLog((t) => t.includes('[replay-bench] first fix'), 90_000, 'the first replayed fix')
const firstFixAt = Date.now()
shell(`dumpsys gfxinfo ${pkg} reset`)

// SurfaceFlinger keeps the last 128 frames; read them ~10 s before the window closes.
let surfaceFlinger: ReturnType<typeof readSurfaceFlinger> = null
const steps: { at: number; act: () => void }[] = [
  { at: Math.max(0, windowS - 10), act: () => (surfaceFlinger = readSurfaceFlinger()) },
]
const screenshot = values.screenshot
if (screenshot) {
  steps.push({
    at: windowS / 2,
    act: () =>
      writeFileSync(
        screenshot,
        Bun.spawnSync(['adb', '-s', serial, 'exec-out', 'screencap', '-p']).stdout,
      ),
  })
}
for (const step of steps.sort((a, b) => a.at - b.at)) {
  await sleep(Math.max(0, firstFixAt + step.at * 1000 - Date.now()))
  step.act()
}

const text = await waitForLog(
  (t) => parseLog(t).length > 0 || t.includes('[replay-bench] failed'),
  windowS * 1000 + 60_000,
  'SPIKE_RESULT',
)
const result = parseLog(text)[0]
if (!result)
  throw new Error(
    `bench failed:\n${text
      .split('\n')
      .filter((l) => l.includes('replay-bench'))
      .join('\n')}`,
  )
const gfxinfo = parseGfxinfo(shell(`dumpsys gfxinfo ${pkg}`))

const label = values.label ?? `${result.sdk}-${result.startedAt.replaceAll(':', '-')}`
mkdirSync(values.out, { recursive: true })
const path = join(values.out, `${label}.json`)
writeFileSync(
  path,
  JSON.stringify({ ...result, android: { serial, gfxinfo, surfaceFlinger } }, null, 2),
)
console.log(
  `${path}: ${result.sdk} ${result.replay?.branch}@${result.replay?.commit} js p95 ${result.total.js.p95} ms, ` +
    `janky ${gfxinfo.jankyPct}%, gfx p90 ${gfxinfo.p90} ms`,
)

function parseGfxinfo(dump: string) {
  const num = (re: RegExp) => Number(dump.match(re)?.[1] ?? NaN)
  return {
    frames: num(/Total frames rendered: (\d+)/),
    janky: num(/Janky frames: (\d+)/),
    jankyPct: num(/Janky frames: \d+ \(([\d.]+)%\)/),
    p50: num(/50th percentile: (\d+)ms/),
    p90: num(/90th percentile: (\d+)ms/),
    p95: num(/95th percentile: (\d+)ms/),
    p99: num(/99th percentile: (\d+)ms/),
    slowUiThread: num(/Number Slow UI thread: (\d+)/),
    slowBitmapUploads: num(/Number Slow bitmap uploads: (\d+)/),
    slowDraw: num(/Number Slow issue draw commands: (\d+)/),
    frameDeadlineMissed: num(/Number Frame deadline missed: (\d+)/),
  }
}

/** Present-to-present deltas of the app's SurfaceView (the map GL surface), if it has one. */
function readSurfaceFlinger() {
  const layer = shell('dumpsys SurfaceFlinger --list')
    .split('\n')
    // Newer builds wrap names: `RequestedLayerState{<name> parentId=..}`.
    .map((l) => l.trim().replace(/^RequestedLayerState\{(.*?)( parentId=.*)?\}$/, '$1'))
    .find((l) => l.includes(`SurfaceView[${pkg}`) && l.includes('(BLAST)'))
  if (!layer) return null
  return parseLatency(layer, shell(`dumpsys SurfaceFlinger --latency '${layer}'`))
}

function parseLatency(layer: string, dump: string) {
  const [periodLine, ...rows] = dump.trim().split('\n')
  const refreshMs = Number(periodLine) / 1e6
  const presents = rows
    .map((row) => Number(row.trim().split(/\s+/)[1]))
    .filter((v) => v > 0 && v < 1e18)
  const deltas = presents.slice(1).map((v, i) => (v - presents[i]!) / 1e6)
  const sorted = [...deltas].sort((a, b) => a - b)
  const pct = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
  const round = (v: number) => Math.round(v * 100) / 100
  return {
    layer,
    refreshMs: round(refreshMs),
    frames: presents.length,
    p50: round(pct(50)),
    p90: round(pct(90)),
    p99: round(pct(99)),
    max: round(sorted.at(-1) ?? 0),
    /** Present gaps longer than 1.5 refresh periods: missed map frames (or an idle map). */
    over1_5Refresh: deltas.filter((d) => d > refreshMs * 1.5).length,
  }
}
