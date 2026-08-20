/** The one completion operation behind every successful Board linking (ADR 0035, #409). */
export interface BoardLinkCompletionPort {
  /**
   * Persist the Board and its Board Link durably. Must resolve only once native has finished the
   * write — the connect below reads the Board Link back out of the native database.
   */
  persist(): Promise<void>
  /** Durable selection, in JS and native. */
  select(): void
  /**
   * Explicit Connect on the freshly linked Board: native clears its Automatic Connection Pause and
   * creates the durable Connect Intent before any radio work starts.
   */
  connect(): Promise<void>
  /** Dismiss the setup UI. */
  dismiss(): void
}

export interface BoardLinkCompletionOptions {
  /**
   * `false` for an offline Board. It still saves and gets selected, and never attempts a
   * connection — there is nothing to connect to.
   */
  hasLink: boolean
}

/**
 * Finish Board setup: persist, select, connect, dismiss — in that order, and shared by new Board
 * creation and existing Board re-linking so the choreography exists exactly once.
 *
 * Ordering is the whole point. Native owns the Board Link and reads it back from its own database
 * when it connects, so persistence has to *finish* before the connect is issued; a connect racing
 * an unfinished write finds no link and fails on a Board that is, in fact, linked.
 *
 * The Connect Intent is durable and native creates it at the head of the explicit-Connect path, so
 * the handoff is complete once the call is issued. The session outcome that follows is rendered
 * afterwards by the Connect pill — a failed connection leaves the Board, its Board Link, and the
 * Connect Intent exactly where they are, and never rolls the save back.
 *
 * Returns `false` when persistence failed: nothing is selected, nothing connects, and setup stays
 * open so the rider can retry rather than losing the Board.
 */
export async function completeBoardLink(
  port: BoardLinkCompletionPort,
  { hasLink }: BoardLinkCompletionOptions,
): Promise<boolean> {
  try {
    await port.persist()
  } catch {
    return false
  }

  port.select()
  if (hasLink) {
    // A rejected connect is a failed *session*, not a failed save. Native keeps the Connect Intent.
    void port.connect().catch(() => {})
  }
  port.dismiss()
  return true
}
