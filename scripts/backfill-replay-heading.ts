/**
 * Backfills `phone-heading` lines into a Debug Recording made before the compass was recorded.
 *
 * The headings it writes are *derived from the recording's own GPS bearings*, not measured. That is
 * a deliberate line: a fixture is a stage prop, and a prop may be built. What must never happen is
 * production code inventing a compass and presenting it as a sensor reading — that stand-in is what
 * ADR 0024 rejected, and it stays rejected. Anything replaying a backfilled fixture runs the exact
 * code path a real recording drives; only the file is synthetic.
 *
 * Prefer a fresh recording when you can make one: a real compass carries lean, mount offset and
 * rotation while standing still, none of which a GPS course knows about. This exists for the
 * fixtures already committed, which cannot be re-ridden.
 *
 * Usage:
 *   bun run scripts/backfill-replay-heading.ts shared/fixtures/replay-thor301.jsonl
 */
import { readFileSync, writeFileSync } from 'fs'

/** Matches `PHONE_HEADING_RECORD_INTERVAL_MS` — the cadence a real recording captures at. */
const SAMPLE_INTERVAL_MS = 100

/**
 * Below this the GPS bearing is noise: a stopped phone reports whatever it last moved along, or
 * jitters freely. A rider stopped at a light is not spinning, so the heading holds instead.
 */
const MOVING_SPEED_MPS = 0.8

interface Fix {
  t: number
  bearingDeg: number
  speedMps: number
}

/** Shortest-arc interpolation, so 350° → 10° crosses north instead of sweeping back through south. */
function lerpBearing(from: number, to: number, ratio: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180
  return (((from + delta * ratio) % 360) + 360) % 360
}

function headingLines(fixes: Fix[]): { t: number; line: string }[] {
  const moving = fixes.filter((fix) => fix.speedMps >= MOVING_SPEED_MPS)
  if (moving.length < 2) return []

  const lines: { t: number; line: string }[] = []
  const start = moving[0]!.t
  const end = moving[moving.length - 1]!.t
  let index = 0

  for (let t = start; t <= end; t += SAMPLE_INTERVAL_MS) {
    while (index < moving.length - 2 && moving[index + 1]!.t <= t) index += 1
    const from = moving[index]!
    const to = moving[index + 1]!
    // A gap means the rider stopped: hold the bearing that led into it rather than easing across
    // the pause, which would rotate the map while the puck sits still.
    const span = to.t - from.t
    const ratio = span > 0 ? Math.min(1, (t - from.t) / span) : 0
    const headingDeg = Math.round(lerpBearing(from.bearingDeg, to.bearingDeg, ratio) * 10) / 10
    lines.push({ t, line: JSON.stringify({ t, kind: 'phone-heading', headingDeg }) })
  }

  return lines
}

function backfill(path: string): void {
  const original = readFileSync(path, 'utf8')
  const lines = original.split('\n')

  if (lines.some((line) => line.includes('"phone-heading"'))) {
    console.log(`${path}: already has phone-heading lines, skipped`)
    return
  }

  const fixes: Fix[] = []
  for (const line of lines) {
    if (!line.includes('"kind":"location"')) continue
    const json = JSON.parse(line) as Record<string, unknown>
    if (typeof json.bearingDeg !== 'number' || typeof json.speedMps !== 'number') continue
    fixes.push({ t: json.t as number, bearingDeg: json.bearingDeg, speedMps: json.speedMps })
  }

  const headings = headingLines(fixes)
  if (headings.length === 0) {
    console.log(`${path}: no usable GPS bearings, nothing written`)
    return
  }

  // Merge on `t`, stable: an existing line and a new one at the same offset keep the recording's
  // line first, matching how a live recorder would have interleaved them.
  const merged: string[] = []
  let next = 0
  for (const line of lines) {
    const t = line.startsWith('{') ? ((JSON.parse(line) as { t: number }).t ?? 0) : Infinity
    while (next < headings.length && headings[next]!.t <= t) {
      merged.push(headings[next]!.line)
      next += 1
    }
    merged.push(line)
  }
  while (next < headings.length) {
    merged.push(headings[next]!.line)
    next += 1
  }

  writeFileSync(path, merged.join('\n'))
  console.log(
    `${path}: wrote ${headings.length} phone-heading lines from ${fixes.length} GPS fixes`,
  )
}

const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('usage: bun run scripts/backfill-replay-heading.ts <recording.jsonl>...')
  process.exit(1)
}
for (const path of paths) backfill(path)
