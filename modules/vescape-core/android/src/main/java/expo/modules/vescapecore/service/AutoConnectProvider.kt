package expo.modules.vescapecore.service

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri

/**
 * Process-start trigger for auto-connect: a `ContentProvider` is created before `Application` hands
 * off to anything else, so this runs with no JS runtime in sight.
 *
 * @parity /modules/vescape-core/ios/connection/VescapeLaunchSubscriber.swift
 */
class AutoConnectProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        context?.applicationContext?.let { app ->
            // Publish cold wrist settings even when auto-connect leaves the service stopped.
            CoreForegroundService.reloadTelemetrySettings(app)
            CoreForegroundService.autoConnectSelectedBoard(app)
            // Enrolled Accessories come up on the same trigger but through their own path: they are
            // not gated on a selected Board, the Board auto-connect setting, or a manual Board stop.
            CoreForegroundService.autoConnectAccessories(app)
        }
        return true
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0
}
