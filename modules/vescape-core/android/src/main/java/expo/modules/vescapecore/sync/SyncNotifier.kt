package expo.modules.vescapecore.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import expo.modules.vescapecore.R

/**
 * The one notification backup raises: it has stopped, and only the Rider can restart it.
 *
 * Deliberately narrow — ordinary retries, offline stretches and a metered connection say nothing.
 * A [SyncPauseReason] does not resolve on its own, and a backup that has silently stopped for weeks
 * is the failure this feature can least afford, so each reason gets one actionable notification and
 * is cleared again the moment the pause lifts.
 *
 * @parity /modules/vescape-core/ios/sync/SyncNotifier.swift
 */
internal class SyncNotifier private constructor(private val context: Context) {
  private var channelReady = false

  /** Show the notification for [reason], replacing any previous one, or clear it when null. */
  fun update(reason: SyncPauseReason?) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (reason == null) {
      manager.cancel(NOTIFICATION_ID)
      return
    }
    ensureChannel(manager)
    manager.notify(NOTIFICATION_ID, build(reason))
  }

  private fun ensureChannel(manager: NotificationManager) {
    if (channelReady) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Backup", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Tells you when ride backup has stopped and needs you"
      },
    )
    channelReady = true
  }

  private fun build(reason: SyncPauseReason) = NotificationCompat.Builder(context, CHANNEL_ID)
    .setContentTitle("Backup paused")
    .setContentText(text(reason))
    .setStyle(NotificationCompat.BigTextStyle().bigText(text(reason)))
    .setSmallIcon(R.drawable.ic_vesc_notification)
    .setContentIntent(openApp())
    .setCategory(NotificationCompat.CATEGORY_ERROR)
    .setAutoCancel(true)
    .build()

  private fun openApp(): PendingIntent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
    return PendingIntent.getActivity(
      context,
      REQUEST_OPEN,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  internal companion object {
    private const val CHANNEL_ID = "vescape_backup"
    private const val NOTIFICATION_ID = 4271
    private const val REQUEST_OPEN = 1

    /**
     * What the Rider has to do, in the same three shapes the account widget names.
     *
     * @parity /modules/vescape-core/ios/sync/SyncNotifier.swift `text`
     */
    fun text(reason: SyncPauseReason): String = when (reason) {
      SyncPauseReason.AUTHENTICATION -> "Sign in again to keep backing up your rides."
      SyncPauseReason.PROTOCOL -> "Update Vescape to keep backing up your rides."
      SyncPauseReason.ROW_TOO_LARGE -> "Backup hit an error. Check the event log in settings."
    }

    @Volatile private var instance: SyncNotifier? = null

    fun get(context: Context): SyncNotifier =
      instance ?: synchronized(this) {
        instance ?: SyncNotifier(context.applicationContext).also { instance = it }
      }
  }
}
