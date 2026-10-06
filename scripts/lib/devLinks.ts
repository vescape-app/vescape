/**
 * Deep links the dev scripts send to the phone app.
 *
 * The watch ride `wear:ride` and `watchos:ride` start: the thor301 Debug Recording replayed, and
 * normal Navigation to the recording's last fix. The ride loops around a pond Directions never
 * plans, so the same run exercises off-route behavior.
 */
const REPLAY = 'replay-thor301.jsonl'
const DIRECTION_POINT = { latitude: 51.13185, longitude: 16.98653 }

/**
 * Dev-only deep link the phone app handles in `src/app/dev/watch-ride.tsx`. The scheme is the
 * caller's: Android targets the package explicitly, while iOS needs the bundle-id scheme because a
 * simulator with the store build beside the dev build would route `vescape://` to either.
 */
export function watchRideUrl(scheme: string): string {
  return `${scheme}://dev/watch-ride?replay=${REPLAY}&lat=${DIRECTION_POINT.latitude}&lon=${DIRECTION_POINT.longitude}`
}

/** The local Metro server a dev build loads its bundle from. */
export const METRO_URL = 'http://127.0.0.1:8081'

/** Dev-client link that (re)loads the bundle from [METRO_URL]. */
export function devClientUrl(scheme: string): string {
  return `${scheme}://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`
}
