import type { MapPointErrorCode } from 'vescape-core'

/**
 * @parity /modules/vescape-core/src/index.ts `MapPointErrorCode`
 */
const MESSAGES: Record<MapPointErrorCode, string> = {
  MAP_POINT_SIGN_IN_REQUIRED: 'Sign in to add or change map features.',
  MAP_POINT_NOT_YOURS: 'Only the rider who added this feature can change it.',
  MAP_POINT_GONE: 'This map feature no longer exists.',
  MAP_POINT_REFUSED: 'The server refused this map feature.',
  MAP_POINT_UNREACHABLE: 'Could not reach the server. Map features need a connection.',
}

function isMapPointErrorCode(value: unknown): value is MapPointErrorCode {
  return typeof value === 'string' && value in MESSAGES
}

export function mapPointErrorCode(error: unknown): MapPointErrorCode | null {
  const code = (error as { code?: unknown } | null)?.code
  return isMapPointErrorCode(code) ? code : null
}

export function mapPointErrorMessage(error: unknown): string {
  const code = mapPointErrorCode(error)
  return code ? MESSAGES[code] : 'Map features are unavailable right now.'
}
