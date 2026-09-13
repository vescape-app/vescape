import type { AccessoryCompatibility, AccessoryInspectionError } from 'vescape-core'

/**
 * How an Accessory stands with the app right now.
 *
 * - `advertising` — a running scan is hearing it this moment.
 * - `idle` — its manifest was read successfully, and nothing is scanning to say more than that.
 * - `unreachable` — the last handshake with it failed.
 *
 * Discovery holds no connection: the handshake disconnects as soon as the manifest is read, so
 * "connected" is deliberately absent until enrollment gives an Accessory a session to stay in.
 */
export type AccessoryLinkStatus = 'advertising' | 'idle' | 'unreachable'

export interface AccessoryStatusCopy {
  label: string
  /** A `theme.status` / `theme.palette` key resolved by the caller, never a color literal. */
  tone: 'success' | 'neutral' | 'caution'
}

export function accessoryStatusCopy(status: AccessoryLinkStatus): AccessoryStatusCopy {
  switch (status) {
    case 'advertising':
      return { label: 'Nearby', tone: 'success' }
    case 'unreachable':
      return { label: 'Not reachable', tone: 'caution' }
    case 'idle':
      return { label: 'Paired', tone: 'neutral' }
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

/** Why a handshake produced no manifest, in rider language. */
export function inspectionErrorCopy(error: AccessoryInspectionError): string {
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
  }
}
