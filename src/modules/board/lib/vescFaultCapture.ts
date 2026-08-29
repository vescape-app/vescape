import type { VescFaultCapture, VescFaultCaptureSample } from 'vescape-core'

/**
 * Where one capture sample sits relative to the incident it documents.
 *
 * `pre` is the five seconds copied out of the native recent live window before detection,
 * `incident` covers the activation itself, and `tail` is what arrived after the controller reported
 * a clear. A capture whose occurrence is still open has no `tail`.
 */
export type VescFaultCapturePhase = 'pre' | 'incident' | 'tail'

/** Phase of one sample. `clearedAtMs` is the occurrence's clear time, null while still active. */
export function capturePhase(
  sample: VescFaultCaptureSample,
  capture: VescFaultCapture,
  clearedAtMs: number | null,
): VescFaultCapturePhase {
  if (sample.capturedAtMs < capture.openedAtMs) return 'pre'
  if (clearedAtMs != null && sample.capturedAtMs > clearedAtMs) return 'tail'
  return 'incident'
}

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
 * The `limit` samples closest to detection, still in chronological order, plus how many were left
 * out. A long fault can retain thousands of rows; the detail view shows the incident edge rather
 * than everything.
 */
export function samplesAroundIncident(
  samples: VescFaultCaptureSample[],
  capture: VescFaultCapture,
  limit: number,
): { shown: VescFaultCaptureSample[]; omitted: number } {
  if (samples.length <= limit) return { shown: samples, omitted: 0 }
  // Index of the first sample at or after detection; the window is centred there.
  let pivot = samples.findIndex((s) => s.capturedAtMs >= capture.openedAtMs)
  if (pivot < 0) pivot = samples.length - 1
  const half = Math.floor(limit / 2)
  const start = Math.min(Math.max(pivot - half, 0), samples.length - limit)
  return { shown: samples.slice(start, start + limit), omitted: samples.length - limit }
}

/** Signed offset label for a sample row, e.g. `-4.83s` / `+0.20s`. */
export function fmtCaptureOffset(offsetMs: number): string {
  const seconds = offsetMs / 1000
  return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(2)}s`
}
