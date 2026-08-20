package expo.modules.vescapecore.notification

import expo.modules.vescapecore.R

import expo.modules.vescapecore.connection.PRESENCE_SCAN_WINDOW_MS

import expo.modules.vescapecore.service.VESC_SESSION_TAG

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat

internal class NotificationController(
    private val service: Service,
    private val serviceClass: Class<*>,
    private val channelId: String,
    private val notificationId: Int,
    private val stopAction: String,
    private val connectAction: String,
    private val disconnectAction: String,
    private val stopSearchAction: String,
) {
    fun createChannel() {
        val channel = NotificationChannel(
            channelId,
            "VESC Board Monitoring",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Shows while monitoring board and GPS data"
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
        }
        service.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun show(
        text: String,
        deviceName: String?,
        shortCriticalText: String?,
        batteryPercent: Int? = null,
        sessionActive: Boolean = false,
        canConnect: Boolean = false,
    ) {
        service.getSystemService(NotificationManager::class.java)
            .notify(
                notificationId,
                build(text, deviceName, shortCriticalText, batteryPercent, sessionActive, canConnect),
            )
    }

    /**
     * Temporary Board Presence Scan progress notification (ADR 0035). The service starts in the
     * foreground with this one immediately — there is no regular-service-to-foreground promotion —
     * and it is replaced by the Board Session notification on a match, or removed on timeout /
     * **Stop search**.
     */
    fun showSearching(deviceName: String?, deadlineAtMs: Long?, nowMs: Long) {
        service.getSystemService(NotificationManager::class.java)
            .notify(notificationId, buildSearching(deviceName, deadlineAtMs, nowMs))
    }

    fun buildSearching(deviceName: String?, deadlineAtMs: Long?, nowMs: Long): Notification =
        NotificationCompat.Builder(service, channelId)
            .setContentTitle(deviceName ?: "VESC")
            .setContentText("Looking for your board\u2026")
            .setSmallIcon(R.drawable.ic_vesc_notification)
            .setContentIntent(buildOpenAppIntent())
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setShortCriticalText("\u22ef")
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .applySearchProgress(deadlineAtMs, nowMs)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Stop search",
                buildServiceActionIntent(REQUEST_STOP_SEARCH, stopSearchAction),
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Exit",
                buildServiceActionIntent(REQUEST_EXIT, stopAction),
            )
            .build()
            .apply {
                flags = flags or Notification.FLAG_ONGOING_EVENT or Notification.FLAG_NO_CLEAR
            }

    fun cancel() {
        service.getSystemService(NotificationManager::class.java).cancel(notificationId)
    }

    fun build(
        text: String,
        deviceName: String?,
        shortCriticalText: String?,
        batteryPercent: Int? = null,
        sessionActive: Boolean = false,
        canConnect: Boolean = false,
    ): Notification {
        val title = deviceName ?: "VESC"
        return NotificationCompat.Builder(service, channelId)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_vesc_notification)
            .setContentIntent(buildOpenAppIntent())
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(shortCriticalText ?: "—")
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .apply {
                if (batteryPercent != null) {
                    setProgress(100, batteryPercent.coerceIn(0, 100), false)
                } else {
                    setProgress(0, 0, false)
                }
                when {
                    sessionActive -> addAction(
                        android.R.drawable.ic_menu_close_clear_cancel,
                        "Disconnect",
                        buildServiceActionIntent(REQUEST_DISCONNECT, disconnectAction),
                    )
                    canConnect -> addAction(
                        android.R.drawable.ic_menu_send,
                        "Connect",
                        buildServiceActionIntent(REQUEST_CONNECT, connectAction),
                    )
                }
            }
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Exit",
                buildServiceActionIntent(REQUEST_EXIT, stopAction),
            )
            .build()
            .apply {
                flags = flags or Notification.FLAG_ONGOING_EVENT or Notification.FLAG_NO_CLEAR
            }
    }

    fun closeAppTask() {
        closeAppTask(service)
    }

    companion object {
        private const val REQUEST_EXIT = 1
        private const val REQUEST_DISCONNECT = 2
        private const val REQUEST_CONNECT = 3
        private const val REQUEST_STOP_SEARCH = 4

        fun closeAppTask(context: Context) {
            try {
                context.getSystemService(ActivityManager::class.java)
                    ?.appTasks
                    ?.forEach { it.finishAndRemoveTask() }
            } catch (e: Exception) {
                Log.w(VESC_SESSION_TAG, "App task cleanup failed: ${e.message}")
            }
        }
    }

    private fun buildServiceActionIntent(requestCode: Int, action: String): PendingIntent {
        val intent = Intent(service, serviceClass).apply { this.action = action }
        return PendingIntent.getService(
            service,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun buildOpenAppIntent(): PendingIntent {
        val intent = service.packageManager.getLaunchIntentForPackage(service.packageName) ?: Intent()
        return PendingIntent.getActivity(
            service,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}

/**
 * Determinate five-second countdown for the Board Presence Scan (#405).
 *
 * The window is measured from *scanner readiness*, never from foreground entry, so the bar only
 * becomes determinate once `BoardPresenceScan` publishes a deadline. Until then the radio is still
 * coming up and there is no honest clock to show. The chronometer keeps counting down without a
 * repaint, so the notification survives the screen locking mid-scan.
 */
private fun NotificationCompat.Builder.applySearchProgress(
    deadlineAtMs: Long?,
    nowMs: Long,
): NotificationCompat.Builder {
    if (deadlineAtMs == null) return setProgress(0, 0, true)
    val windowMs = PRESENCE_SCAN_WINDOW_MS.toInt()
    val remainingMs = (deadlineAtMs - nowMs).coerceIn(0L, PRESENCE_SCAN_WINDOW_MS).toInt()
    return setProgress(windowMs, windowMs - remainingMs, false)
        .setWhen(deadlineAtMs)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
}
