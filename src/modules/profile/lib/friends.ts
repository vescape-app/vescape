import type { Friend, Friends, RiderProfileErrorCode } from 'vescape-core'

import { fmtTimeAgo } from '@/helpers/format'

/** Mirrors vescape-server `RiderSearchQuerySchema`: what the server would search for, or null. */
const SEARCH_PATTERN = /^[A-Za-z0-9_]{1,20}$/

export function riderSearchPrefix(input: string): string | null {
  const prefix = input.trim()
  return SEARCH_PATTERN.test(prefix) ? prefix : null
}

/** Where another rider stands with this Account. */
export type FriendRelation = 'self' | 'friend' | 'incoming' | 'outgoing' | 'none'

export function friendRelation(
  lists: Friends,
  accountId: string,
  ownAccountId: string | null,
): FriendRelation {
  if (accountId === ownAccountId) return 'self'
  const has = (rows: { accountId: string }[]) => rows.some((row) => row.accountId === accountId)
  if (has(lists.friends)) return 'friend'
  if (has(lists.incoming)) return 'incoming'
  if (has(lists.outgoing)) return 'outgoing'
  return 'none'
}

/** True when a friend riding now was not riding in the previous list. */
export function friendStartedRiding(previous: Friend[], next: Friend[]): boolean {
  const riding = new Set(previous.filter((f) => f.ridingNow).map((f) => f.accountId))
  return next.some((friend) => friend.ridingNow && !riding.has(friend.accountId))
}

/** The status line under a friend's nick. */
export function friendStatus(friend: Friend, nowMs: number): string {
  if (friend.ridingNow) return 'Riding now'
  const at = friend.lastOnlineAt ? Date.parse(friend.lastOnlineAt) : NaN
  return Number.isFinite(at) ? `Last seen ${fmtTimeAgo(at, nowMs)}` : 'Not online yet'
}

/** Riding friends first, then the most recently online; never-online last. */
export function sortFriends(friends: Friend[]): Friend[] {
  const online = (friend: Friend) => (friend.lastOnlineAt ? Date.parse(friend.lastOnlineAt) : 0)
  return friends
    .slice()
    .sort(
      (a, b) =>
        Number(b.ridingNow) - Number(a.ridingNow) ||
        online(b) - online(a) ||
        a.nick.localeCompare(b.nick),
    )
}

/**
 * Native rejects friends calls with the Rider Profile codes; this is where they become words.
 *
 * @parity /modules/vescape-core/src/index.ts `RiderProfileErrorCode`
 */
const MESSAGES: Record<RiderProfileErrorCode, string> = {
  RIDER_PROFILE_SIGN_IN_REQUIRED: 'Sign in to add friends.',
  RIDER_PROFILE_NICK_TAKEN: 'The server refused this request.',
  RIDER_PROFILE_REFUSED: 'The server refused this request.',
  RIDER_PROFILE_UNREACHABLE: 'Could not reach the server. Check your connection.',
}

export function friendsErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code in MESSAGES
    ? MESSAGES[code as RiderProfileErrorCode]
    : 'Friends are unavailable right now.'
}
