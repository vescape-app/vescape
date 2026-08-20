package expo.modules.vescapecore.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.vescapecore.R
import expo.modules.vescapecore.diagnostics.ConnectionTrace
import expo.modules.vescapecore.diagnostics.ConnectionTraceDecision
import expo.modules.vescapecore.diagnostics.ConnectionTraceEvent
import expo.modules.vescapecore.diagnostics.ConnectionTraceField
import expo.modules.vescapecore.diagnostics.ConnectionTraceOrigin
import expo.modules.vescapecore.diagnostics.ConnectionTraceOwner
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason
import expo.modules.vescapecore.recording.RideSummary
import expo.modules.vescapecore.recording.RideSummaryBuilder
import expo.modules.vescapecore.recording.RideSummaryLink
import expo.modules.vescapecore.recording.RideSummaryPolicy
import expo.modules.vescapecore.recording.RideSummaryText
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.DEFAULT_RIDE_SPLIT_GAP_MINUTES
import expo.modules.vescapecore.telemetry.RideSummaryNotificationEntity
import expo.modules.vescapecore.telemetry.TELEMETRY_BUCKET_SIZE_MS
import expo.modules.vescapecore.telemetry.TelemetryDatabase

/**
 * One silent Ride Summary Notification per finalized, Ride-History-eligible Ride Recording (#410).
 *
 * Deduplication is durable, not in memory: the `ride_summary_notifications` table is keyed by the
 * stable Ride History recording id. The row is *claimed* (INSERT OR IGNORE, inside the database's
 * own transaction) **before** the notification is posted, and released again only when posting
 * threw. A crash between claim and post therefore loses that one notification rather than
 * duplicating it — the ordering the issue asks for, resolved in the safe direction.
 *
 * Ride summaries are not foreground-service work, so this deliberately does not go through
 * `ForegroundWork` / `reconcileForegroundWork`; it posts on its own low-importance channel.
 *
 * @parity /modules/vescape-core/ios/recording/RideSummaryController.swift
 */
internal object RideSummaryNotifier {
  /** Separate low-importance, soundless channel so a summary never behaves like a session alert. */
  internal const val CHANNEL_ID = "vesc_ride_summary"
  internal const val NOTIFICATION_ID = 4102

  /** How far back to look for the ride that just finalized. */
  private const val LOOKBACK_MS = 24L * 60L * 60L * 1000L

  fun createChannel(context: Context) {
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Ride summaries",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Silent summary after a ride is recorded"
      setSound(null, null)
      enableVibration(false)
      enableLights(false)
      setShowBadge(false)
    }
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  /**
   * Called on every Ride Recording finalization — including repeated callbacks for the same ride,
   * which the durable claim collapses to one notification.
   */
  suspend fun onRecordingFinalized(context: Context, boardId: String?, nowMs: Long) {
    val app = context.applicationContext
    val workflow = ConnectionTrace.start(
      app,
      ConnectionTraceOrigin.RIDE_FINALIZED,
      ConnectionTraceOwner.NONE,
      mapOf(ConnectionTraceField.BOARD_ID to boardId),
    )
    try {
      val settings = AppDataRepository.get(app).getTypedSettings()
      val gapMs = settings.rideSplitGapMinutes.toLong().coerceAtLeast(1L) * 60_000L
      val ride = loadLatestRide(app, nowMs, gapMs)
      val permissionGranted = NotificationManagerCompat.from(app).areNotificationsEnabled()
      val dao = TelemetryDatabase.get(app).telemetryDao()
      val alreadyNotified = ride != null && dao.countRideSummaryNotification(ride.rideId) > 0

      workflow.event(
        ConnectionTraceEvent.RIDE_SUMMARY_PREPARED,
        mapOf(
          ConnectionTraceField.RIDE_ID to ride?.rideId,
          ConnectionTraceField.PERMISSION_GRANTED to permissionGranted,
        ),
      )

      val skip = RideSummaryPolicy.skipReason(
        ride = ride,
        settingEnabled = settings.rideSummaryNotificationsEnabled,
        permissionGranted = permissionGranted,
        alreadyNotified = alreadyNotified,
      )
      if (skip != null || ride == null) {
        workflow.event(
          ConnectionTraceEvent.RIDE_SUMMARY_SKIPPED,
          mapOf(
            ConnectionTraceField.RIDE_ID to ride?.rideId,
            ConnectionTraceField.REASON to (skip ?: ConnectionTraceReason.RIDE_NOT_ELIGIBLE),
          ),
        )
        workflow.finish(
          ConnectionTraceDecision.SKIPPED,
          skip ?: ConnectionTraceReason.RIDE_NOT_ELIGIBLE,
        )
        return
      }

      // Claim first: losing the race here means another finalize callback already owns this ride.
      val claimed = dao.insertRideSummaryNotification(
        RideSummaryNotificationEntity(rideId = ride.rideId, notifiedAtMs = nowMs),
      ) != -1L
      if (!claimed) {
        workflow.event(
          ConnectionTraceEvent.RIDE_SUMMARY_SKIPPED,
          mapOf(
            ConnectionTraceField.RIDE_ID to ride.rideId,
            ConnectionTraceField.REASON to ConnectionTraceReason.ALREADY_NOTIFIED,
          ),
        )
        workflow.finish(ConnectionTraceDecision.SKIPPED, ConnectionTraceReason.ALREADY_NOTIFIED)
        return
      }

      try {
        post(app, ride, batteryPercent(app, boardId, ride))
      } catch (e: Exception) {
        // Posting failed, so nothing was delivered — give the claim back rather than silently
        // burning this ride's one summary.
        dao.deleteRideSummaryNotification(ride.rideId)
        throw e
      }

      workflow.event(
        ConnectionTraceEvent.RIDE_SUMMARY_NOTIFIED,
        mapOf(ConnectionTraceField.RIDE_ID to ride.rideId),
      )
      workflow.finish(ConnectionTraceDecision.COMPLETED, ConnectionTraceReason.END_RIDE)
    } catch (e: Exception) {
      Log.w(VESC_SESSION_TAG, "Ride summary failed: ${e.message}")
      workflow.finish(
        ConnectionTraceDecision.FAILED,
        ConnectionTraceReason.PLATFORM_ERROR,
        mapOf(ConnectionTraceField.PLATFORM_ERROR_DOMAIN to (e::class.simpleName ?: "Exception")),
      )
    }
  }

  private suspend fun loadLatestRide(context: Context, nowMs: Long, gapMs: Long): RideSummary? {
    val dao = TelemetryDatabase.get(context).telemetryDao()
    val buckets = dao.getHistoryBucketsSinceAsc(nowMs - LOOKBACK_MS)
    if (buckets.isEmpty()) return null
    val markers = dao.getMarkers(
      fromMs = buckets.minOf { it.firstSampleAtMs } - gapMs,
      toMs = buckets.maxOf { it.lastSampleAtMs } + TELEMETRY_BUCKET_SIZE_MS,
      deviceId = null,
    )
    return RideSummaryBuilder.latestFinalizedRide(buckets, markers, gapMs)
  }

  /** Final valid Battery SoC Estimate, or null so the battery text is omitted entirely. */
  private suspend fun batteryPercent(context: Context, boardId: String?, ride: RideSummary): Int? {
    val id = boardId ?: return null
    val last = AppDataRepository.get(context).getBoard(id)?.get("lastBattery") as? Map<*, *>
      ?: return null
    return RideSummaryBuilder.validBatteryPercent(
      ride,
      (last["percent"] as? Number)?.toDouble(),
      (last["at"] as? Number)?.toLong(),
    )
  }

  private fun post(context: Context, ride: RideSummary, batteryPercent: Int?) {
    createChannel(context)
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle("Ride recorded")
      .setContentText(RideSummaryText.body(ride.distanceM, ride.durationMs, batteryPercent))
      .setSmallIcon(R.drawable.ic_vesc_notification)
      .setContentIntent(rideDeepLinkIntent(context, ride.rideId))
      .setAutoCancel(true)
      .setOngoing(false)
      .setSilent(true)
      .setShowWhen(true)
      .setWhen(ride.endAtMs)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
    context.getSystemService(NotificationManager::class.java)
      .notify(NOTIFICATION_ID, notification)
  }

  private fun rideDeepLinkIntent(context: Context, rideId: String): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(RideSummaryLink.uri(rideId))).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return PendingIntent.getActivity(
      context,
      rideId.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}
