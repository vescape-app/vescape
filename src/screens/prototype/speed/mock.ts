/**
 * PROTOTYPE — synthetic ride data so the variants read like a real session in screenshots and
 * without a board connected. None of this is wired to native; it is scenery.
 */
import type { TelemetryChartPoint } from '@/components/charts/chartMath'

/** Deterministic pseudo-random so screenshots are stable between runs. */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

/** A plausible speed trace: roll-out, a couple of pulls, one hard slow-down, cruise. */
export function mockSpeedPoints(windowMs: number, now = Date.now()): TelemetryChartPoint[] {
  const random = rng(7)
  const count = 220
  const step = windowMs / count
  const out: TelemetryChartPoint[] = []
  let v = 6
  for (let i = 0; i < count; i++) {
    const t = i / count
    const target = t < 0.12 ? 10 : t < 0.32 ? 26 : t < 0.42 ? 12 : t < 0.68 ? 31 : t < 0.8 ? 22 : 28
    v += (target - v) * 0.08 + (random() - 0.5) * 1.6
    out.push({ date: new Date(now - windowMs + i * step), value: Math.max(0, v) })
  }
  return out
}

export const MOCK_RIDE = {
  topSpeedKmh: 33.4,
  avgSpeedKmh: 23.1,
  personalBestKmh: 36.2,
  dutyPct: 61,
  motorTempC: 58,
  controllerTempC: 49,
  batteryPct: 46,
  sagVolts: 3.1,
  rangeKm: 11.4,
  rangeConfidenceKm: 2.1,
  distanceKm: 8.6,
  durationMin: 27,
  /** Share of ride time spent inside the active alert band. */
  timeInWarnBandPct: 12,
}

/** Time spent at each speed bucket (5 km/h wide) — the "speed envelope" histogram. */
export const MOCK_HISTOGRAM: { from: number; to: number; seconds: number }[] = [
  { from: 0, to: 5, seconds: 42 },
  { from: 5, to: 10, seconds: 96 },
  { from: 10, to: 15, seconds: 148 },
  { from: 15, to: 20, seconds: 262 },
  { from: 20, to: 25, seconds: 431 },
  { from: 25, to: 30, seconds: 388 },
  { from: 30, to: 35, seconds: 173 },
  { from: 35, to: 40, seconds: 21 },
]

export type RideEventKind = 'max' | 'alert' | 'pushback' | 'brake' | 'footpad' | 'start'

export interface RideEvent {
  id: string
  kind: RideEventKind
  atMinute: number
  label: string
  detail: string
}

export const MOCK_EVENTS: RideEvent[] = [
  { id: 'e1', kind: 'start', atMinute: 0, label: 'Ride start', detail: '100% · 18 °C' },
  { id: 'e2', kind: 'alert', atMinute: 4, label: 'Speed alert', detail: 'crossed 28 km/h' },
  { id: 'e3', kind: 'max', atMinute: 9, label: 'Top speed', detail: '33.4 km/h' },
  { id: 'e4', kind: 'brake', atMinute: 12, label: 'Hard slow-down', detail: '31 → 9 km/h in 3 s' },
  { id: 'e5', kind: 'pushback', atMinute: 17, label: 'Pushback', detail: 'duty 82% · 2.1 s' },
  { id: 'e6', kind: 'footpad', atMinute: 21, label: 'Footpad released', detail: 'at 4 km/h' },
  { id: 'e7', kind: 'alert', atMinute: 24, label: 'Speed alert', detail: 'crossed 28 km/h' },
]

/** 20s2p pack: one lazy cell so the balance UI has something to say. */
export const MOCK_CELLS: number[] = [
  3.94, 3.95, 3.94, 3.96, 3.95, 3.93, 3.95, 3.94, 3.96, 3.95, 3.94, 3.79, 3.95, 3.96, 3.94, 3.95,
  3.93, 3.95, 3.94, 3.96,
]

export const MOCK_PACK = {
  cycles: 214,
  healthPct: 91,
  packVolts: 78.6,
  currentA: 12.4,
  tempC: 27,
  /** Voltage the pack sags to at 30 A, from this session. */
  sagAt30A: 71.2,
}

/** Live risk factors for the nosedive-headroom cockpit. `weight` sums to 1. */
export const MOCK_RISK = [
  { id: 'duty', label: 'Duty cycle', value: 61, ceiling: 80, unit: '%', weight: 0.45 },
  { id: 'battery', label: 'Battery', value: 46, ceiling: 20, unit: '%', weight: 0.25 },
  { id: 'temp', label: 'Motor temp', value: 58, ceiling: 85, unit: '°C', weight: 0.2 },
  { id: 'speed', label: 'Speed', value: 28, ceiling: 34, unit: 'km/h', weight: 0.1 },
]
