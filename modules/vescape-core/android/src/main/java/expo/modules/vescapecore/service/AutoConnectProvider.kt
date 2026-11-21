package expo.modules.vescapecore.service

import expo.modules.vescapecore.riderprofiles.RiderStatsSender
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri

/**
 * @parity /modules/vescape-core/ios/connection/VescapeLaunchSubscriber.swift
 */
class AutoConnectProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        context?.applicationContext?.let { app ->
            RiderStatsSender.get(app).foreground()
            CoreForegroundService.reloadTelemetrySettings(app)
            CoreForegroundService.autoConnectSelectedBoard(app)
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
