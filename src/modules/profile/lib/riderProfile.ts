import type { RiderProfileErrorCode } from 'vescape-core'

const NICK_PATTERN = /^[A-Za-z0-9_]{3,20}$/
const NATIONALITY_PATTERN = /^[A-Z]{2}$/

export const NICK_MAX_LENGTH = 20

export interface RiderProfileDraft {
  nick: string
  nationality: string | null
}

export function parseRiderProfileDraft(
  nick: string,
  nationality: string,
): { draft: RiderProfileDraft } | { error: string } {
  const trimmedNick = nick.trim()
  if (!NICK_PATTERN.test(trimmedNick)) {
    return { error: 'Nick must be 3–20 letters, digits or underscores.' }
  }
  const country = nationality.trim().toUpperCase()
  if (country && !NATIONALITY_PATTERN.test(country)) {
    return { error: 'Nationality must be a two-letter country code, like PL.' }
  }
  return { draft: { nick: trimmedNick, nationality: country || null } }
}

/**
 * @parity /modules/vescape-core/src/index.ts `RiderProfileErrorCode`
 */
const MESSAGES: Record<RiderProfileErrorCode, string> = {
  RIDER_PROFILE_SIGN_IN_REQUIRED: 'Sign in to pick a nick.',
  RIDER_PROFILE_NICK_TAKEN: 'That nick is taken. Try another one.',
  RIDER_PROFILE_REFUSED: 'The server refused this nick.',
  RIDER_PROFILE_UNREACHABLE: 'Could not reach the server. Check your connection.',
}

export function riderProfileErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code in MESSAGES
    ? MESSAGES[code as RiderProfileErrorCode]
    : 'Your rider profile is unavailable right now.'
}
