package expo.modules.vescapecore.connection

/**
 * Hand-off between the two halves of linking: `finalizeBoardLink` proves the connect and then tears
 * its throwaway probe session down, while the Board Link is persisted later, from JS, on Save. This
 * records which Board proved a link so the persist can start the real Board Session — the ride
 * session, with the Board's own name, recording and auto-reconnect — instead of leaving the rider
 * disconnected until the next process start.
 *
 * Single-slot on purpose: only the pick the rider actually saves is worth reconnecting, and a
 * finalize for another Board replaces it.
 *
 * @parity /modules/vescape-core/ios/connection/PendingLinkConnect.swift
 */
internal object PendingLinkConnect {
    private var boardId: String? = null

    @Synchronized
    fun arm(boardId: String) {
        this.boardId = boardId
    }

    /** True once, for the Board that proved a link. */
    @Synchronized
    fun consume(boardId: String): Boolean {
        if (this.boardId != boardId) return false
        this.boardId = null
        return true
    }

    /** The rider left linking without saving: nothing proved is worth reconnecting to. */
    @Synchronized
    fun clear() {
        boardId = null
    }
}
