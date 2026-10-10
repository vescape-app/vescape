import type { VescFaultCapture, VescFaultCaptureSample } from 'vescape-core'

/** Milliseconds from detection; negative inside the pre-roll. */
export function captureOffsetMs(sample: VescFaultCaptureSample, capture: VescFaultCapture): number {
  return sample.capturedAtMs - capture.openedAtMs
}

/**
 * Span actually covered by retained samples, or null before two samples exist. Uses sample
 * timestamps rather than the intended window: the pre-roll is only as long as the live window had.
 */
export function captureSpanMs(samples: VescFaultCaptureSample[]): number | null {
  if (samples.length < 2) return null
  return samples[samples.length - 1].capturedAtMs - samples[0].capturedAtMs
}

/**
 * Achieved Board Session rate across the capture, in Hz, or null when it cannot be derived.
 *
 * Deliberately measured from the samples that arrived. The Board Session is response-paced, so this
 * is evidence of what the controller managed, never an assumed 30 Hz cadence.
 */
export function achievedRateHz(samples: VescFaultCaptureSample[]): number | null {
  const span = captureSpanMs(samples)
  if (span == null || span <= 0) return null
  return ((samples.length - 1) / span) * 1000
}

/**
 * Newest `limit` pre-fault samples, still in chronological order.
 */
export function samplesAroundIncident(
  samples: VescFaultCaptureSample[],
  limit: number,
): { shown: VescFaultCaptureSample[]; omitted: number } {
  if (samples.length <= limit) return { shown: samples, omitted: 0 }
  const start = samples.length - limit
  return { shown: samples.slice(start, start + limit), omitted: samples.length - limit }
}

/** Signed offset label for a sample row, e.g. `-4.83s` / `+0.20s`. */
export function fmtCaptureOffset(offsetMs: number): string {
  const seconds = offsetMs / 1000
  return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(2)}s`
}
