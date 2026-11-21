import type { VescFaultCapture, VescFaultCaptureSample } from 'vescape-core'

export function captureOffsetMs(sample: VescFaultCaptureSample, capture: VescFaultCapture): number {
  return sample.capturedAtMs - capture.openedAtMs
}

export function captureSpanMs(samples: VescFaultCaptureSample[]): number | null {
  if (samples.length < 2) return null
  return samples[samples.length - 1].capturedAtMs - samples[0].capturedAtMs
}

export function achievedRateHz(samples: VescFaultCaptureSample[]): number | null {
  const span = captureSpanMs(samples)
  if (span == null || span <= 0) return null
  return ((samples.length - 1) / span) * 1000
}

export function samplesAroundIncident(
  samples: VescFaultCaptureSample[],
  limit: number,
): { shown: VescFaultCaptureSample[]; omitted: number } {
  if (samples.length <= limit) return { shown: samples, omitted: 0 }
  const start = samples.length - limit
  return { shown: samples.slice(start, start + limit), omitted: samples.length - limit }
}

export function fmtCaptureOffset(offsetMs: number): string {
  const seconds = offsetMs / 1000
  return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(2)}s`
}
