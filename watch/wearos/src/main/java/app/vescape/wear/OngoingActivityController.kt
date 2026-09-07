package app.vescape.wear

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status

class OngoingActivityController(private val context: Context) {
    fun start() {
        if (!canPostNotifications()) return

        createChannel()

        val touchIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notificationBuilder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_vescape_notification)
            .setContentTitle("Vescape")
            .setContentText("Telemetry mirror active")
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setContentIntent(touchIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setLocalOnly(true)

        val status = Status.Builder()
            .addTemplate("Telemetry mirror active")
            .build()

        val ongoingActivity = OngoingActivity.Builder(context, NOTIFICATION_ID, notificationBuilder)
            .setStaticIcon(R.drawable.ic_vescape_notification)
            .setTouchIntent(touchIntent)
            .setStatus(status)
            .build()

        ongoingActivity.apply(context)

        // intentional-suppression: activity failure is recorded by onFailure
        runCatching {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notificationBuilder.build())
        }.onFailure {
            WatchDiagnostics.recordNotificationFailure()
        }
    }

    fun stop() {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    /** Also used by [MainActivity] to decide whether to ask for POST_NOTIFICATIONS first. */
    fun canPostNotifications(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun createChannel() {
        val notificationManager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Vescape mirror",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Keeps the Vescape watch mirror available during a ride."
        }
        notificationManager.createNotificationChannel(channel)
    }

    private companion object {
        const val CHANNEL_ID = "vescape_watch_mirror"
        const val NOTIFICATION_ID = 71
    }
}
