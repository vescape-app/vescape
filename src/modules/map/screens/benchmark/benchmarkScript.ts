/**
 * Spike #658: the scripted SDK comparison run. Pure data: a fixed list of timed events, identical
 * for every SDK. The runner fires each event once its time has passed.
 */

export const BENCH_PHASES = ['follow', 'compass', 'zoomSweeps', 'jumps', 'layers', 'storm'] as const
export type BenchPhase = (typeof BENCH_PHASES)[number]

export type BenchEvent =
  | { t: number; kind: 'phase'; phase: BenchPhase }
  | { t: number; kind: 'gps' }
  | { t: number; kind: 'heading'; heading: number }
  | { t: number; kind: 'zoom'; zoom: number }
  | { t: number; kind: 'recenter' }
  | { t: number; kind: 'jump'; meters: number }
  | { t: number; kind: 'stormCenter'; index: number }
  | { t: number; kind: 'layers'; on: boolean }
  | { t: number; kind: 'end' }

const PHASE_START_MS: Record<BenchPhase, number> = {
  follow: 0,
  compass: 6_000,
  zoomSweeps: 12_000,
  jumps: 27_000,
  layers: 33_000,
  storm: 48_000,
}
export const BENCH_DURATION_MS = 58_000

export const BENCH_START_ZOOM = 16
export const BENCH_GPS_SPEED_KMH = 20
const GPS_TICK_MS = 1000
const COMPASS_TICK_MS = 100
const COMPASS_DEG_PER_S = 12
const SWEEP_TICK_MS = 100
const SWEEP_LOW = 12
const SWEEP_HIGH = 17
const SWEEP_MS = 5000
const STORM_CENTER_MS = 300
const STORM_HEADING_MS = 100
export const MID_JUMP_M = 3000
export const TELEPORT_JUMP_M = 100_000

const compassHeading = (tMs: number) =>
  (((((tMs - PHASE_START_MS.compass) / 1000) * COMPASS_DEG_PER_S) % 360) + 360) % 360

/** z12 -> z17 -> z12 over `periodMs`. */
const triangleZoom = (elapsedMs: number, periodMs: number) => {
  const x = (elapsedMs % periodMs) / periodMs
  return SWEEP_LOW + (SWEEP_HIGH - SWEEP_LOW) * (x < 0.5 ? x * 2 : 2 - x * 2)
}

function range(fromMs: number, toMs: number, stepMs: number) {
  const out: number[] = []
  for (let t = fromMs; t < toMs; t += stepMs) out.push(t)
  return out
}

/**
 * 1 follow fake GPS (curvy, pitch follows zoom) · 2 compass at 10 Hz · 3 three zoom sweeps ·
 * 4 recenter, mid-jump, teleport, recenter · 5 full layer scene on (stays on to the end) ·
 * 6 retarget storm: center every 300 ms, heading every 100 ms, one zoom sweep on top.
 */
export function buildBenchScript(): BenchEvent[] {
  const { compass, zoomSweeps, jumps, layers, storm } = PHASE_START_MS
  const events: BenchEvent[] = [
    ...BENCH_PHASES.map((phase) => ({ t: PHASE_START_MS[phase], kind: 'phase' as const, phase })),
    ...range(GPS_TICK_MS, BENCH_DURATION_MS, GPS_TICK_MS).map((t) => ({ t, kind: 'gps' as const })),
    ...range(compass, storm, COMPASS_TICK_MS).map((t) => ({
      t,
      kind: 'heading' as const,
      heading: compassHeading(t),
    })),
    ...range(zoomSweeps, jumps, SWEEP_TICK_MS).map((t) => ({
      t,
      kind: 'zoom' as const,
      zoom: triangleZoom(t - zoomSweeps, SWEEP_MS),
    })),
    { t: jumps, kind: 'recenter' },
    { t: jumps + 1500, kind: 'jump', meters: MID_JUMP_M },
    { t: jumps + 3500, kind: 'jump', meters: TELEPORT_JUMP_M },
    { t: jumps + 5000, kind: 'recenter' },
    { t: layers, kind: 'layers', on: true },
    ...range(storm, BENCH_DURATION_MS, STORM_CENTER_MS).map((t, index) => ({
      t,
      kind: 'stormCenter' as const,
      index,
    })),
    ...range(storm, BENCH_DURATION_MS, STORM_HEADING_MS).map((t, i) => ({
      t,
      kind: 'heading' as const,
      heading: (compassHeading(t) + 35 * Math.sin(i * 0.9) + 360) % 360,
    })),
    ...range(storm, BENCH_DURATION_MS, SWEEP_TICK_MS).map((t) => ({
      t,
      kind: 'zoom' as const,
      zoom: triangleZoom(t - storm, BENCH_DURATION_MS - storm),
    })),
    { t: BENCH_DURATION_MS, kind: 'end' },
  ]
  // Stable sort keeps phase markers ahead of same-time events.
  return events.sort((a, b) => a.t - b.t)
}

/** Storm center targets: a fixed ring of offsets around the latest fix. */
export const stormOffset = (index: number) => ({ bearing: (index * 137.5) % 360, meters: 150 })
