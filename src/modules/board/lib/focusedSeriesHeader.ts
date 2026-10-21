/**
 * Header for a `/control` detail chart, describing the data the rider is actually looking at:
 * how far back the live window reaches, and the packet rate measured over it. Both numbers are
 * computed natively and ride along with the focused series — JS only formats them.
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `FocusedSeries`
 */
export function formatFocusedSeriesSpan(spanMs: number, fallbackMinutes: number): string {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return `Last ${fallbackMinutes} min`
  return `Last ${formatSpan(spanMs)}`
}

/** Second line of the header: what the line is drawn from, once the feed says how fast it runs. */
export function formatFocusedSeriesDetail(spanMs: number, sampleRateHz: number): string {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return 'Waiting for data'
  const rate = Number.isFinite(sampleRateHz) && sampleRateHz > 0 ? sampleRateHz : null
  if (!rate) return 'Full resolution data'
  return `Full resolution data at ~${rate < 10 ? rate.toFixed(1) : Math.round(rate)} Hz`
}

/**
 * Second line of the telemetry panel: how far the live window reaches — partway while it fills,
 * then the configured length — and the packet rate.
 */
export function formatLiveTelemetryDetail(
  spanMs: number,
  windowMinutes: number,
  rateHz: number | null,
): string {
  if (rateHz == null || !Number.isFinite(spanMs) || spanMs <= 0) return 'Waiting for data'
  const span = formatSpan(spanMs)
  const window = `${windowMinutes} min`
  const reach = span === window ? `Last ${window}` : `${span} of ${window}`
  return `${reach} · ~${rateHz} Hz`
}

/** Sub-minute spans read in seconds; longer ones round to whole minutes. */
function formatSpan(spanMs: number): string {
  const seconds = Math.round(spanMs / 1000)
  if (seconds < 60) return `${Math.max(1, seconds)} s`
  return `${Math.round(seconds / 60)} min`
}
