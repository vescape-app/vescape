import type {
  AccessoryCompatibility,
  AccessoryInspectionError,
  AccessoryLinkPhase,
} from 'vescape-core'

export interface AccessoryStatusCopy {
  label: string
  /** A `theme.status` / `theme.palette` key resolved by the caller, never a color literal. */
  tone: 'success' | 'neutral' | 'caution'
}

/**
 * Rider-facing phrasing for native's link phase. Native decides; this only phrases it.
 *
 * A dropped link reads as "Connecting", not as a failure: both platforms keep the reconnect alive
 * on their own, so a rider who walked out of range is waiting rather than broken. "Not reachable"
 * is reserved for a session that actually went wrong.
 */
export function accessoryStatusCopy(phase: AccessoryLinkPhase): AccessoryStatusCopy {
  switch (phase) {
    case 'connected':
      return { label: 'Connected', tone: 'success' }
    case 'connecting':
      return { label: 'Connecting…', tone: 'neutral' }
    case 'handshaking':
      return { label: 'Checking…', tone: 'neutral' }
    case 'unavailable':
      return { label: 'Not reachable', tone: 'caution' }
    case 'incompatible':
      return { label: 'Not supported', tone: 'caution' }
    case 'idle':
      return { label: 'Saved', tone: 'neutral' }
  }
}

/** Rider-facing summary of native's compatibility verdict. Native decides; this only phrases it. */
export function compatibilityCopy(compatibility: AccessoryCompatibility): {
  title: string
  detail: string
  tone: 'success' | 'caution' | 'error'
} {
  switch (compatibility) {
    case 'supported':
      return {
        title: 'Compatible',
        detail: 'Vescape speaks this accessory’s protocol version and recognises what it offers.',
        tone: 'success',
      }
    case 'unsupported-version':
      return {
        title: 'Protocol not supported',
        detail:
          'This accessory speaks a protocol version Vescape does not. Nothing on it can be configured until one of the two is updated.',
        tone: 'error',
      }
    case 'unsupported-capabilities':
      return {
        title: 'Nothing Vescape can use',
        detail:
          'Vescape reached this accessory, but none of the things it offers are types this app knows how to drive.',
        tone: 'caution',
      }
  }
}

/**
 * Why a handshake produced no manifest, in rider language.
 *
 * The parameter is widened past the union on purpose: these are native's wire strings, and a code
 * this app has no copy for is still worth showing verbatim rather than rendering blank.
 */
export function inspectionErrorCopy(error: AccessoryInspectionError | (string & {})): string {
  switch (error) {
    case 'malformed':
    case 'invalid':
      return 'The accessory answered with something this app could not read.'
    case 'session-mismatch':
      return 'The accessory answered a different request. Try again.'
    case 'oversized':
      return 'The accessory sent more than the protocol allows in one message.'
    case 'invalid-utf8':
      return 'The accessory sent bytes that are not valid text.'
    case 'bluetooth-unavailable':
      return 'Bluetooth is off or unavailable.'
    case 'connect-failed':
      return 'Could not connect. Move closer and try again.'
    case 'service-missing':
      return 'This device does not expose the Vescape Accessory service.'
    case 'write-failed':
      return 'The connection dropped before the handshake was sent.'
    case 'timeout':
      return 'The accessory did not answer in time.'
    case 'cancelled':
      return 'Cancelled.'
    case 'busy':
      return 'Another accessory is being checked right now.'
    default:
      return error
  }
}

/**
 * Why a live session is unhappy, in rider language.
 *
 * These are native's own wire strings, which overlap the handshake errors but add the ones only a
 * session can produce. An unrecognized code falls through to the handshake phrasing rather than
 * being hidden — a code this app has no copy for is still worth showing.
 */
export function linkErrorCopy(error: string): string {
  switch (error) {
    case 'identity-mismatch':
      return 'A different accessory answered at this address. Vescape will keep looking for yours.'
    case 'unknown-device':
      return 'Vescape has not seen this accessory since it was added. Scan for it again.'
    case 'stale_request':
    case 'request_id_reused':
      return 'The accessory and Vescape lost track of each other. The session will restart.'
    case 'unknown_capability':
      return 'The accessory no longer offers something Vescape was configuring.'
    case 'invalid_argument':
      return 'The accessory refused a setting Vescape sent.'
    case 'not_ready':
      return 'The accessory is not ready yet.'
    case 'hardware_error':
      return 'The accessory reported a hardware problem.'
    case 'unsupported_message':
      return 'The accessory does not understand what Vescape asked for.'
    default:
      return inspectionErrorCopy(error)
  }
}
