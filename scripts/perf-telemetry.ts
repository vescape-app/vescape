#!/usr/bin/env bun
/**
 * Telemetry rendering perf harness.
 *
 * Drives the e2e fake feed (20 Hz) on the connected home view, then measures
 * how the app renders it: HWUI frame stats via `dumpsys gfxinfo` (jank %,
 * frame-time percentiles, fps) plus best-effort per-thread CPU from /proc.
 *
 * Run the same harness on the SVG build and the Skia build, then diff:
 *
 *   bun run scripts/perf-telemetry.ts --label svg   --seconds 20
 *   bun run scripts/perf-telemetry.ts --label skia  --seconds 20
 *   bun run scripts/perf-telemetry.ts --compare perf-results/svg-*.json perf-results/skia-*.json
 *
 * Notes:
 * - Run on a PHYSICAL device. Emulator frame/jank/CPU numbers are not
 *   representative; only same-device A/B deltas mean anything.
 * - Needs an E2E build installed (`bun run android:e2e`) so the fake feed
 *   exists. For a debug build, keep Metro running.
 * - Headline metric is gfxinfo. CPU is best-effort (some devices block /proc).
 */
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { applicationId } from '../src/config/appVariant.ts'
import { maestroCommand } from './lib/maestro.ts'

const ROOT = join(import.meta.dir, '..')
const PKG = applicationId
const PERF_FLOW = join(ROOT, 'e2e', 'flows', '_perf-home.yaml')
const RESULTS_DIR = join(ROOT, 'perf-results')

interface Gfx {
  totalFrames: number
  jankyFrames: number
  jankyPct: number
  p50: number
  p90: number
  p95: number
  p99: number
  missedVsync: number
  slowUiThread: number
}

interface ThreadCpu {
  tid: number
  comm: string
  jiffies: number
}

interface Result {
  label: string
  seconds: number
  fps: number
  gfx: Gfx
  cpu: {
    clkTck: number
    /** Whole-process CPU usage as % of one core over the window. */
    processPct: number | null
    /** Top CPU-consuming threads over the window (name -> % of one core). */
    threads: { comm: string; pct: number }[]
  }
  capturedAt: string
}

// ── args ─────────────────────────────────────────────────────────────────────

interface Args {
  seconds: number
  label: string
  out: string | null
  noSetup: boolean
  compare: [string, string] | null
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seconds: 20, label: 'run', out: null, noSetup: false, compare: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      const v = argv[i + 1]
      if (v == null) throw new Error(`Missing value for ${a}`)
      i += 1
      return v
    }
    if (a === '--seconds') args.seconds = Number(next())
    else if (a === '--label') args.label = next()
    else if (a === '--out') args.out = next()
    else if (a === '--no-setup') args.noSetup = true
    else if (a === '--compare') args.compare = [next(), next()]
    else throw new Error(`Unknown argument: ${a}`)
  }
  if (!Number.isFinite(args.seconds) || args.seconds <= 0) throw new Error('--seconds must be > 0')
  return args
}

// ── adb helpers ────────────────────────────────────────────────────────────────

async function sh(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out
}

async function resolveDevice(): Promise<string> {
  const out = await sh(['adb', 'devices'])
  const id = out
    .split('\n')
    .slice(1)
    .find((l) => l.includes('\tdevice'))
    ?.split('\t')[0]
    ?.trim()
  if (!id) {
    console.error('No adb device found. Connect a device and retry.')
    process.exit(1)
  }
  return id
}

const adb = (device: string, ...rest: string[]) => sh(['adb', '-s', device, ...rest])

async function getPid(device: string): Promise<number | null> {
  const out = (await adb(device, 'shell', 'pidof', PKG)).trim()
  const pid = Number(out.split(/\s+/)[0])
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

// ── gfxinfo ──────────────────────────────────────────────────────────────────

function num(re: RegExp, text: string): number {
  const m = text.match(re)
  return m ? Number(m[1]) : 0
}

function parseGfx(text: string): Gfx {
  return {
    totalFrames: num(/Total frames rendered:\s*(\d+)/, text),
    jankyFrames: num(/Janky frames:\s*(\d+)/, text),
    jankyPct: num(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/, text),
    p50: num(/50th percentile:\s*(\d+)ms/, text),
    p90: num(/90th percentile:\s*(\d+)ms/, text),
    p95: num(/95th percentile:\s*(\d+)ms/, text),
    p99: num(/99th percentile:\s*(\d+)ms/, text),
    missedVsync: num(/Number Missed Vsync:\s*(\d+)/, text),
    slowUiThread: num(/Number Slow UI thread:\s*(\d+)/, text),
  }
}

// ── per-thread CPU via /proc ───────────────────────────────────────────────────

/** stat fields: comm is wrapped in parens (field 2); utime=14, stime=15. */
function parseStatJiffies(stat: string): { comm: string; jiffies: number } | null {
  const open = stat.indexOf('(')
  const close = stat.lastIndexOf(')')
  if (open < 0 || close < 0) return null
  const comm = stat.slice(open + 1, close)
  const rest = stat
    .slice(close + 2)
    .trim()
    .split(/\s+/)
  // rest[0] is field 3 (state); utime=field14 -> rest[11], stime=field15 -> rest[12]
  const utime = Number(rest[11])
  const stime = Number(rest[12])
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null
  return { comm, jiffies: utime + stime }
}

async function snapshotThreads(device: string, pid: number): Promise<Map<number, ThreadCpu>> {
  const map = new Map<number, ThreadCpu>()
  // Single shell call: cat every task stat, tids are the dir names.
  const out = await adb(
    device,
    'shell',
    `for d in /proc/${pid}/task/*; do echo "@@$(basename $d)"; cat $d/stat 2>/dev/null; done`,
  )
  let tid = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) {
      tid = Number(line.slice(2).trim())
      continue
    }
    if (!line.trim() || !tid) continue
    const parsed = parseStatJiffies(line)
    if (parsed) map.set(tid, { tid, comm: parsed.comm, jiffies: parsed.jiffies })
  }
  return map
}

async function getClkTck(device: string): Promise<number> {
  const v = Number((await adb(device, 'shell', 'getconf', 'CLK_TCK')).trim())
  return Number.isFinite(v) && v > 0 ? v : 100
}

// ── measure ──────────────────────────────────────────────────────────────────

async function runSetup(): Promise<void> {
  console.log('› Setup: connecting board via Maestro (_perf-home.yaml)…')
  const proc = Bun.spawn(await maestroCommand('test', '-e', `APP_ID=${applicationId}`, PERF_FLOW), {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) {
    console.error('Maestro setup failed. Is the E2E build installed and Metro running?')
    process.exit(code ?? 1)
  }
}

async function measure(args: Args): Promise<void> {
  const device = await resolveDevice()
  console.log(`Device: ${device}`)

  if (!args.noSetup) await runSetup()

  const pid = await getPid(device)
  if (!pid) {
    console.error(`${PKG} is not running. Launch the app (or drop --no-setup).`)
    process.exit(1)
  }
  console.log(`pid: ${pid}`)

  const clkTck = await getClkTck(device)

  // Best-effort CPU start snapshot (may be empty if /proc is locked down).
  const startThreads = await snapshotThreads(device, pid)

  await adb(device, 'shell', 'dumpsys', 'gfxinfo', PKG, 'reset')
  console.log(`› Measuring ${args.seconds}s on the live telemetry view…`)
  await Bun.sleep(args.seconds * 1000)

  const gfxText = await adb(device, 'shell', 'dumpsys', 'gfxinfo', PKG)
  const gfx = parseGfx(gfxText)
  const endThreads = await snapshotThreads(device, pid)

  // CPU deltas
  const threadDeltas: { comm: string; pct: number }[] = []
  let totalDeltaJiffies = 0
  for (const [tid, end] of endThreads) {
    const start = startThreads.get(tid)
    if (!start) continue
    const dj = end.jiffies - start.jiffies
    if (dj <= 0) continue
    totalDeltaJiffies += dj
    const pct = (dj / clkTck / args.seconds) * 100
    threadDeltas.push({ comm: end.comm, pct })
  }
  threadDeltas.sort((a, b) => b.pct - a.pct)
  const haveCpu = startThreads.size > 0 && endThreads.size > 0 && totalDeltaJiffies > 0

  const result: Result = {
    label: args.label,
    seconds: args.seconds,
    fps: gfx.totalFrames / args.seconds,
    gfx,
    cpu: {
      clkTck,
      processPct: haveCpu ? (totalDeltaJiffies / clkTck / args.seconds) * 100 : null,
      threads: threadDeltas.slice(0, 8),
    },
    capturedAt: new Date().toISOString(),
  }

  printResult(result, haveCpu)

  const outPath = args.out ?? join(RESULTS_DIR, `${args.label}-${Date.now()}.json`)
  mkdirSync(RESULTS_DIR, { recursive: true })
  writeFileSync(outPath, JSON.stringify(result, null, 2))
  console.log(`\nSaved → ${outPath}`)
}

// ── output ──────────────────────────────────────────────────────────────────

function printResult(r: Result, haveCpu: boolean): void {
  const g = r.gfx
  console.log(`\n── ${r.label} (${r.seconds}s) ─────────────────────────────`)
  console.log(`  fps (rendered):   ${r.fps.toFixed(1)}`)
  console.log(`  total frames:     ${g.totalFrames}`)
  console.log(`  janky frames:     ${g.jankyFrames} (${g.jankyPct.toFixed(1)}%)`)
  console.log(`  frame ms  p50/p90/p95/p99: ${g.p50}/${g.p90}/${g.p95}/${g.p99}`)
  console.log(`  missed vsync:     ${g.missedVsync}`)
  console.log(`  slow UI thread:   ${g.slowUiThread}`)
  if (haveCpu && r.cpu.processPct != null) {
    console.log(`  process CPU:      ${r.cpu.processPct.toFixed(0)}% of one core`)
    console.log(`  top threads:`)
    for (const t of r.cpu.threads) {
      console.log(`    ${t.comm.padEnd(18)} ${t.pct.toFixed(0)}%`)
    }
  } else {
    console.log(`  process CPU:      (unavailable — /proc locked down on this device)`)
  }
}

function pct(from: number, to: number): string {
  if (from === 0) return to === 0 ? '0%' : 'n/a'
  const d = ((to - from) / from) * 100
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(1)}%`
}

function compare(aPath: string, bPath: string): void {
  const a = JSON.parse(readFileSync(aPath, 'utf8')) as Result
  const b = JSON.parse(readFileSync(bPath, 'utf8')) as Result
  console.log(`\nCompare:  A=${a.label}   B=${b.label}\n`)
  const rows: [string, number, number, boolean][] = [
    ['fps (rendered)', a.fps, b.fps, true],
    ['janky %', a.gfx.jankyPct, b.gfx.jankyPct, false],
    ['frame p50 (ms)', a.gfx.p50, b.gfx.p50, false],
    ['frame p90 (ms)', a.gfx.p90, b.gfx.p90, false],
    ['frame p95 (ms)', a.gfx.p95, b.gfx.p95, false],
    ['frame p99 (ms)', a.gfx.p99, b.gfx.p99, false],
    ['slow UI thread', a.gfx.slowUiThread, b.gfx.slowUiThread, false],
    ['process CPU %', a.cpu.processPct ?? 0, b.cpu.processPct ?? 0, false],
  ]
  const pad = (s: string, n: number) => s.padEnd(n)
  console.log(`  ${pad('metric', 18)}${pad('A', 12)}${pad('B', 12)}${pad('Δ', 12)}better`)
  for (const [name, av, bv, higherBetter] of rows) {
    const better = av === bv ? '=' : bv > av === higherBetter ? 'B' : 'A'
    console.log(
      `  ${pad(name, 18)}${pad(av.toFixed(1), 12)}${pad(bv.toFixed(1), 12)}${pad(pct(av, bv), 12)}${better}`,
    )
  }
  console.log('\n(higher fps better; everything else lower is better)')
}

// ── main ──────────────────────────────────────────────────────────────────────

let args: Args
try {
  args = parseArgs(Bun.argv.slice(2))
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}

if (args.compare) {
  compare(args.compare[0], args.compare[1])
} else {
  await measure(args)
}
