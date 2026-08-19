package expo.modules.vescapecore.service

import android.app.Activity
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import java.util.Collections
import java.util.WeakHashMap

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

/**
 * Which activities are currently started, tracked by identity rather than by a counter (#405).
 *
 * A plain counter cannot tell a real stop from a stale or duplicated `onActivityStopped` for an
 * activity that was already accounted for — and an unbalanced counter turns the *next* callback
 * into a spurious foreground entry that would cancel or restart live Presence Scan work. Weak keys
 * so a leaked reference here can never keep a destroyed activity alive.
 */
internal class ForegroundEntryTracker {
    private val started: MutableSet<Any> = Collections.newSetFromMap(WeakHashMap())

    /** True when this start took the app from background to foreground. */
    fun started(activity: Any): Boolean = started.add(activity) && started.size == 1

    fun stopped(activity: Any) {
        started.remove(activity)
    }

    val startedCount: Int get() = started.size
}

/** Starts one Presence Scan per real foreground entry — a rotation or activity swap is not one. */
internal class VescapeForegroundObserver(
    private val application: Application,
    private val onForegroundEntry: (Application) -> Unit = { CoreForegroundService.startPresenceScan(it) },
) : Application.ActivityLifecycleCallbacks {
    private val tracker = ForegroundEntryTracker()

    override fun onActivityStarted(activity: Activity) {
        if (tracker.started(activity)) onForegroundEntry(application)
    }

    override fun onActivityStopped(activity: Activity) {
        tracker.stopped(activity)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

    override fun onActivityResumed(activity: Activity) = Unit

    override fun onActivityPaused(activity: Activity) = Unit

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    override fun onActivityDestroyed(activity: Activity) = Unit
}
