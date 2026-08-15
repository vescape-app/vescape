/** Threshold marker rendered on gauge scales (linear and dual). */
export interface DualGaugeAlert {
  id: string
  threshold: number
  thresholdMax: number | null
  /** True for a rule that keeps announcing while the value stays past `threshold`. */
  repeats?: boolean
  /** Optional numeric label drawn at the `threshold` tick (e.g. `20%`, `38 km/h`). */
  label?: string
  /** Optional numeric label drawn at the `thresholdMax` tick of a range marker. */
  labelMax?: string
}

/**
 * The stretch of scale a rule keeps making noise over, as 0–1 fractions, or `null` when the rule
 * only announces at a point.
 *
 * It always runs to the end of the scale. A range rule holds a sustained tone above its
 * `thresholdMax` and a repeating rule never stops above its threshold, so a band that stopped at
 * `thresholdMax` would leave the loudest part of the scale looking empty. The `thresholdMax` tick
 * still marks where the ticking tops out.
 */
export function alertBandFractions(
  alert: DualGaugeAlert,
  fractionOf: (value: number) => number,
): { from: number; to: number } | null {
  const isRange = alert.thresholdMax != null && alert.thresholdMax > alert.threshold
  if (!isRange && !alert.repeats) return null
  const from = fractionOf(alert.threshold)
  if (from >= 1) return null
  return { from, to: 1 }
}
