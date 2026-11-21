import type { AlertTestRule } from 'vescape-core'
import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'

const EMPTY_RANGE_MS = 2_500
const ALERT_ZONE_MS = 5_000
/** A Geiger range plays its ramp over this long, end to end. */
const RANGE_ZONE_MS = 8_000
const TAIL_MS = 12_000
/** Share of the range before a threshold that already plays slowly, so the crossing is watchable. */
const ZONE_LEAD = 0.03
/** Share of the range after a threshold that stays slow while its line plays. */
const ZONE_TRAIL = 0.05

export interface AlertTestSweep {
  durationMs: number
  /** Piecewise-linear progress→share of the sweep; slow around alerts, fast between them. */
  easing: (progress: number) => number
}

/**
 * Pace a preview sweep by its rules: empty stretches pass in [EMPTY_RANGE_MS] for the whole range,
 * each threshold zone takes [ALERT_ZONE_MS], a Geiger range [RANGE_ZONE_MS], and past the last
 * alert the sweep slows to leave time for a repeat. [alertAbove] false sweeps from max down.
 */
export function alertZoneSweep(
  rules: AlertTestRule[],
  min: number,
  max: number,
  alertAbove: boolean,
): AlertTestSweep {
  const share = (value: number) => (alertAbove ? value - min : max - value) / (max - min)
  const zones = rules
    .map((rule) => {
      const from = share(rule.threshold)
      const to = rule.thresholdMax == null ? from : share(rule.thresholdMax)
      return { from: Math.min(from, to), to: Math.max(from, to), range: to !== from }
    })
    .filter((zone) => zone.to > 0 && zone.from < 1)
    .sort((a, b) => a.from - b.from)

  const segments: { to: number; ms: number }[] = []
  let at = 0
  const advance = (to: number, ms: number) => {
    const end = Math.min(to, 1)
    if (end <= at) return
    segments.push({ to: end, ms })
    at = end
  }
  zones.forEach((zone, index) => {
    const next = zones[index + 1]?.from ?? 1
    const lead = zone.from - ZONE_LEAD
    advance(lead, (lead - at) * EMPTY_RANGE_MS)
    advance(
      Math.min(zone.to + ZONE_TRAIL, Math.max(next - ZONE_LEAD, zone.to)),
      zone.range ? RANGE_ZONE_MS : ALERT_ZONE_MS,
    )
  })
  advance(1, zones.length > 0 ? TAIL_MS : EMPTY_RANGE_MS)

  const durationMs = segments.reduce((sum, it) => sum + it.ms, 0)
  const times = [0]
  const values = [0]
  for (const segment of segments) {
    times.push(times[times.length - 1] + segment.ms / durationMs)
    values.push(segment.to)
  }
  return {
    durationMs,
    easing: (progress: number) => {
      'worklet'
      if (progress <= 0) return 0
      if (progress >= 1) return 1
      for (let i = 1; i < times.length; i++) {
        if (progress <= times[i]) {
          const local = (progress - times[i - 1]) / (times[i] - times[i - 1] || 1)
          return values[i - 1] + (values[i] - values[i - 1]) * local
        }
      }
      return 1
    },
  }
}

/** Deduplicate the start and optional ceiling of every visible rule for chart rendering. */
export function getAlertThresholdValues(rules: AlertTestRule[]): number[] {
  const values = new Set<number>()
  for (const rule of rules) {
    if (Number.isFinite(rule.threshold)) values.add(rule.threshold)
    if (rule.thresholdMax != null && Number.isFinite(rule.thresholdMax)) {
      values.add(rule.thresholdMax)
    }
  }
  return [...values].sort((a, b) => a - b)
}

export function toTestRule(rule: DraftAlertRule): AlertTestRule {
  return {
    id: `alert-test:custom:${rule.id}`,
    controlId: rule.controlId,
    threshold: rule.threshold,
    thresholdMax: rule.thresholdMax,
    spec: rule.spec,
    repeatEverySeconds: rule.repeatEverySeconds,
  }
}
