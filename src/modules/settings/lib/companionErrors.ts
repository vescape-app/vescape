/**
 * Native rejects auto-start calls with coded errors whose messages are Android internals
 * ("user_rejected"). Never show those raw — map them to rider-facing text, or to nothing when the
 * rider simply backed out of the system chooser.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/service/CompanionPresence.kt `associateOrObserve`
 */

const CANCELLED = 'COMPANION_ASSOCIATION_CANCELLED'

const MESSAGES: Record<string, string> = {
  COMPANION_PRESENCE_UNSUPPORTED: 'This phone cannot start the app on its own.',
  COMPANION_PRESENCE_PERMISSION_MISSING: 'Auto start is missing a permission on this build.',
  COMPANION_BOARD_UNLINKED: 'Link this board to Bluetooth first.',
  COMPANION_ACTIVITY_MISSING: 'Reopen settings and try again.',
  COMPANION_ASSOCIATION_FAILED: 'Android could not pair with the board. Try again.',
  COMPANION_OBSERVE_FAILED: 'Android refused to watch for this board. Try again.',
}

const codeOf = (error: unknown): string | null =>
  typeof error === 'object' && error != null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null

/** The rider dismissed the system device chooser — expected, say nothing. */
export const isCompanionCancelled = (error: unknown) => codeOf(error) === CANCELLED

/** Rider-facing text for a failed auto-start call, or null when it should stay silent. */
export function companionErrorMessage(error: unknown, fallback: string): string | null {
  if (isCompanionCancelled(error)) return null
  const code = codeOf(error)
  return (code && MESSAGES[code]) || fallback
}
