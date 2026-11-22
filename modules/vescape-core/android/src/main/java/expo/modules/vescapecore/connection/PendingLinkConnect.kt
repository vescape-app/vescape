package expo.modules.vescapecore.connection

/**
 * @parity /modules/vescape-core/ios/connection/PendingLinkConnect.swift
 */
internal object PendingLinkConnect {
    private var boardId: String? = null

    @Synchronized
    fun arm(boardId: String) {
        this.boardId = boardId
    }

    @Synchronized
    fun consume(boardId: String): Boolean {
        if (this.boardId != boardId) return false
        this.boardId = null
        return true
    }

    @Synchronized
    fun clear() {
        boardId = null
    }
}
