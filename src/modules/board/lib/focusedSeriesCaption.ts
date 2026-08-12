/**
 * Caption for a `/control` detail chart, describing the data the rider is actually looking at:
 * how far back the live window reaches and the packet rate measured over it. Both numbers are
 * computed natively and ride along with the focused series — JS only formats them.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `FocusedSeries`
 */
export function formatFocusedSeriesCaption(spanMs: number, sampleRateHz: number): string | null {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return null
  const rate = Number.isFinite(sampleRateHz) && sampleRateHz > 0 ? sampleRateHz : null
  const rateText = rate ? ` at ~${rate < 10 ? rate.toFixed(1) : Math.round(rate)} Hz` : ''
  return `Full resolution data from last ${formatSpan(spanMs)}${rateText}`
}

/** Sub-minute spans read in seconds; longer ones round to whole minutes. */
function formatSpan(spanMs: number): string {
  const seconds = Math.round(spanMs / 1000)
  if (seconds < 60) return `${Math.max(1, seconds)} s`
  return `${Math.round(seconds / 60)} min`
}
