package expo.modules.vescapecore.service

import android.app.Activity
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle

/**
 * Native lifecycle entry point for the Board Presence Scan (ADR 0035).
 *
 * A `ContentProvider` runs before `Application.onCreate`, so the observer is attached before any JS
 * exists. The scan is driven by *foreground entry*, not by process start, module creation, or JS
 * `AppState`: every 0→1 transition of started activities starts one scan.
 *
 * @parity /modules/vescape-core/ios/connection/VescapeLaunchSubscriber.swift
 */
class VescapeLifecycleProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        val app = context?.applicationContext as? Application ?: return true
        app.registerActivityLifecycleCallbacks(VescapeForegroundObserver(app))
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

/** Counts started activities so a rotation or an activity swap is not mistaken for re-entry. */
internal class VescapeForegroundObserver(
    private val application: Application,
    private val onForegroundEntry: (Application) -> Unit = { CoreForegroundService.startPresenceScan(it) },
) : Application.ActivityLifecycleCallbacks {
    private var startedActivities = 0

    override fun onActivityStarted(activity: Activity) {
        startedActivities += 1
        if (startedActivities == 1) onForegroundEntry(application)
    }

    override fun onActivityStopped(activity: Activity) {
        startedActivities = (startedActivities - 1).coerceAtLeast(0)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

    override fun onActivityResumed(activity: Activity) = Unit

    override fun onActivityPaused(activity: Activity) = Unit

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    override fun onActivityDestroyed(activity: Activity) = Unit
}
