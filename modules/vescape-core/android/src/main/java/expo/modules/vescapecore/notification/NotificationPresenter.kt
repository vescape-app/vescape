package expo.modules.vescapecore.notification

import expo.modules.vescapecore.protocol.RefloatTelemetry

import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.connection.displayText
import android.app.Notification
import expo.modules.vescapecore.notices.RideNoticeContent
import expo.modules.vescapecore.notices.RideNoticeSeverity

/**
 * Foreground notification contract:
 *
 * - The notification mirrors the Board phase. Every phase renders its own [displayText]; no phase
 *   borrows another's copy (a reconnecting session says "Reconnecting…", never "Board not connected").
 * - The notification outlives the Board Session: after a disconnect it stays up as idle + Connect.
 *   It is only cancelled on Exit / auto close.
 * - Actions derive from *session ownership*, not link health. A session that exists but has no live
 *   link (Stale, Reconnecting, Rescanning, Error) still offers Disconnect — losing the link must
 *   never strand the rider with a notification they cannot act on.
 * - Telemetry values (text, battery progress, chip) are shown only in Connected, so a dead link can
 *   never display stale numbers.
 *
 * Repaint scheduling is the caller's job — see `BoardSessionController.refreshNotification`.
 */
internal class NotificationPresenter(
    private val controller: NotificationController,
    private val deviceName: () -> String?,
    private val sessionActive: () -> Boolean,
    private val canConnect: () -> Boolean,
    private val rideNotice: () -> RideNoticeContent?,
) {
    fun show(
        phase: BoardPhase,
        telemetry: RefloatTelemetry? = null,
        batteryPercent: Double? = null,
        errorMessage: String? = null,
    ) {
        val presentation = NotificationPresentation.resolve(phase, telemetry, batteryPercent, errorMessage, rideNotice())
        controller.show(
            presentation.text,
            deviceName(),
            presentation.shortCriticalText,
            presentation.batteryProgressPercent,
            sessionActive() && presentation.canDisconnect,
            canConnect(),
        )
    }

    fun build(
        phase: BoardPhase,
        telemetry: RefloatTelemetry? = null,
        batteryPercent: Double? = null,
        errorMessage: String? = null,
    ): Notification {
        val presentation = NotificationPresentation.resolve(phase, telemetry, batteryPercent, errorMessage, rideNotice())
        return controller.build(
            presentation.text,
            deviceName(),
            presentation.shortCriticalText,
            presentation.batteryProgressPercent,
            sessionActive() && presentation.canDisconnect,
            canConnect(),
        )
    }
}

internal data class NotificationPresentation(
    val text: String,
    val shortCriticalText: String?,
    val batteryProgressPercent: Int?,
    val canDisconnect: Boolean,
) {
    companion object {
        fun resolve(
            phase: BoardPhase,
            telemetry: RefloatTelemetry? = null,
            batteryPercent: Double? = null,
            errorMessage: String? = null,
            rideNotice: RideNoticeContent? = null,
        ): NotificationPresentation {
            val visibleTelemetry = telemetry.takeIf { phase == BoardPhase.Connected }
            val visibleBatteryPercent = batteryPercent.takeIf { phase == BoardPhase.Connected }
            return NotificationPresentation(
                text = withRideNotice(
                    resolveText(phase, visibleTelemetry, visibleBatteryPercent, errorMessage),
                    rideNotice,
                ),
                shortCriticalText = NotificationFormatter.formatShortCriticalText(
                    phase,
                    visibleTelemetry,
                    visibleBatteryPercent,
                ),
                batteryProgressPercent = visibleBatteryPercent?.toInt(),
                canDisconnect = phase.canDisconnect(),
            )
        }
    }
}

/**
 * Disconnect stays offered for every phase that still owns a Board Session, including the
 * reconnect phases — a rider watching "Searching…" must be able to end the session from the
 * notification. Only the terminal/transient phases without anything to cancel drop the action.
 */
private fun BoardPhase.canDisconnect(): Boolean = when (this) {
    BoardPhase.Connected,
    BoardPhase.Connecting,
    BoardPhase.Discovering,
    BoardPhase.Subscribing,
    BoardPhase.WaitingForTelemetry,
    BoardPhase.Stale,
    BoardPhase.Reconnecting,
    BoardPhase.Rescanning,
    BoardPhase.Error -> true
    BoardPhase.Idle,
    BoardPhase.Disconnecting -> false
}

/**
 * The top Ride Notice leads the status line, severity as a glyph: `⚠ Low battery · Connected`.
 * @parity /targets/ride-activity/RideActivityWidget.swift `noticeSymbol`
 */
private fun withRideNotice(text: String, notice: RideNoticeContent?): String {
    notice ?: return text
    val glyph = when (notice.severity) {
        RideNoticeSeverity.CRITICAL -> "‼"
        RideNoticeSeverity.WARNING -> "⚠"
        RideNoticeSeverity.INFO -> "ℹ"
    }
    return "$glyph ${notice.title} · $text"
}

private fun resolveText(
    phase: BoardPhase,
    telemetry: RefloatTelemetry?,
    batteryPercent: Double?,
    errorMessage: String?,
): String = when {
    phase == BoardPhase.Connected && telemetry != null ->
        NotificationFormatter.formatTelemetryText(telemetry, batteryPercent)
    phase == BoardPhase.Error && errorMessage != null -> errorMessage
    else -> phase.displayText()
}
