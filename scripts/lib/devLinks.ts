const REPLAY = 'replay-thor301.jsonl'
const DIRECTION_POINT = { latitude: 51.13185, longitude: 16.98653 }

export function watchRideUrl(scheme: string, navigation = true): string {
  return `${scheme}://dev/watch-ride?replay=${REPLAY}&lat=${DIRECTION_POINT.latitude}&lon=${DIRECTION_POINT.longitude}${navigation ? '' : '&navigation=off'}`
}

export const METRO_URL = `http://127.0.0.1:${process.env.E2E_METRO_PORT ?? '8081'}`

export function devClientUrl(scheme: string): string {
  return `${scheme}://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`
}
