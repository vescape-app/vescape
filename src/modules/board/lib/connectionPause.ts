import type { ConnectionPauseState } from 'vescape-core'

/**
 * Rider-facing wording for an Automatic Connection Pause (ADR 0035). Native owns the deadline and
 * the reason; this file owns only how they read, so no `@parity` tag belongs here.
 */
const REASON_LABELS: Record<string, string> = {
  manual_disconnect: 'you disconnected',
  end_ride: 'you ended the ride',
  app_exit: 'you closed the app',
  task_removed: 'you swiped the app away',
}

export const connectionPauseReason = (source: string): string =>
  REASON_LABELS[source] ?? 'you stopped riding'

/** A pause is over the moment its absolute deadline passes — there is nothing to poll. */
export const isConnectionPauseActive = (
  pause: ConnectionPauseState | null,
  now: number,
): pause is ConnectionPauseState => pause != null && pause.until > now

/** Coarse remaining time: riders act on "about an hour", never on "58 minutes 12 seconds". */
export const connectionPauseRemaining = (untilMs: number, now: number): string => {
  const minutes = Math.ceil((untilMs - now) / 60_000)
  if (minutes <= 1) return 'less than a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
