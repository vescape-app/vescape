export interface DualGaugeAlert {
  id: string
  threshold: number
  thresholdMax: number | null
  repeats?: boolean
  label?: string
  labelMax?: string
}

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
