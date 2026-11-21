package expo.modules.vescapecore.notification

import expo.modules.vescapecore.protocol.RefloatTelemetry

import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.connection.displayText
import android.app.Notification
import expo.modules.vescapecore.notices.RideNoticeContent
import expo.modules.vescapecore.notices.RideNoticeSeverity

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
