package expo.modules.vescapecore.connection

import android.content.Context
import expo.modules.vescapecore.diagnostics.ConnectionTrace
import expo.modules.vescapecore.diagnostics.ConnectionTraceDecision
import expo.modules.vescapecore.diagnostics.ConnectionTraceEvent
import expo.modules.vescapecore.diagnostics.ConnectionTraceField
import expo.modules.vescapecore.diagnostics.ConnectionTraceOrigin
import expo.modules.vescapecore.diagnostics.ConnectionTraceOwner
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason

/**
 * Board Link persistence trace (ADR 0035, #409). Linking and re-linking end in a live connection,
 * so the Event Log has to show the moment the Board Link actually became durable — the connect that
 * follows reads it back from the database, and a connect against a link that never landed is the
 * exact failure this ordering exists to prevent.
 *
 * Every Board write funnels through the same native upsert (renames, battery edits, warning
 * dismissals), so only writes that *change* the Board Link are traced. Everything else is noise.
 *
 * @parity /modules/vescape-core/ios/connection/BoardLinkTrace.swift
 */
object BoardLinkTrace {
    /**
     * True when this Board write is the moment a Board Link becomes durable: a link is present and
     * differs from the stored one. A re-saved identical link, or a Board with no link at all, is
     * not a linking event.
     */
    fun isLinkPersist(previousBleId: String?, nextBleId: String?): Boolean =
        nextBleId != null && nextBleId != previousBleId

    /** The BLE id inside a Board record's `link` value, or `null` for an offline Board. */
    fun bleIdOfLink(link: Any?): String? {
        @Suppress("UNCHECKED_CAST")
        val fields = link as? Map<String, Any?> ?: return null
        return (fields["bleId"] as? String)?.takeIf { it.isNotBlank() }
    }

    fun persisted(appCtx: Context, boardId: String, bleId: String) {
        val workflow = start(appCtx, boardId)
        workflow.event(
            ConnectionTraceEvent.BOARD_LINK_PERSISTED,
            mapOf(
                ConnectionTraceField.BOARD_ID to boardId,
                ConnectionTraceField.BLE_ID to bleId,
            ),
        )
        workflow.finish(ConnectionTraceDecision.COMPLETED, ConnectionTraceReason.MATCHED)
    }

    fun failed(appCtx: Context, boardId: String, message: String?) {
        val workflow = start(appCtx, boardId)
        workflow.event(
            ConnectionTraceEvent.BOARD_LINK_FAILED,
            mapOf(
                ConnectionTraceField.BOARD_ID to boardId,
                ConnectionTraceField.PLATFORM_ERROR_CODE to message,
            ),
        )
        workflow.finish(ConnectionTraceDecision.FAILED, ConnectionTraceReason.PLATFORM_ERROR)
    }

    private fun start(appCtx: Context, boardId: String) = ConnectionTrace.start(
        appCtx,
        ConnectionTraceOrigin.BOARD_LINKED,
        ConnectionTraceOwner.NONE,
        mapOf(ConnectionTraceField.BOARD_ID to boardId),
    )
}
