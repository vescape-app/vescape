package expo.modules.vescapecore.recording

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.database.sqlite.SQLiteCantOpenDatabaseException
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteFullException
import android.database.sqlite.SQLiteReadOnlyDatabaseException
import java.util.concurrent.Executors
import io.sentry.Sentry
import expo.modules.vescapecore.telemetry.TelemetryDatabase

internal enum class RecordingStorageFailureKind(val wireValue: String) {
    WriteFailed("write_failed"),
    StorageUnavailable("storage_unavailable"),
    FullDisk("full_disk"),
}

internal fun recordingFailureState(kind: RecordingStorageFailureKind): Map<String, Any> = mapOf(
    "kind" to kind.wireValue,
    "storageUnavailable" to (kind != RecordingStorageFailureKind.WriteFailed),
)

internal fun resolveRecordingFailureKind(
    current: RecordingStorageFailureKind?,
    incoming: RecordingStorageFailureKind,
): RecordingStorageFailureKind = current?.takeIf { it != RecordingStorageFailureKind.WriteFailed } ?: incoming

internal data class RecordingFailureReport(val operation: String, val category: String, val errorType: String)

internal class StorageUnavailableException(kind: RecordingStorageFailureKind) :
    IllegalStateException("Local storage is unavailable (${kind.wireValue})")

internal class StorageFailureState(initial: RecordingStorageFailureKind? = null) {
    var current: RecordingStorageFailureKind? = initial; private set
    private var generation = 0L
    fun startupGeneration(): Long = generation
    fun clearAfterSuccessfulStartup(startedAt: Long): Boolean {
        if (generation != startedAt) return false
        current = null
        return true
    }
    fun record(kind: RecordingStorageFailureKind): Boolean {
        val resolved = resolveRecordingFailureKind(current, kind)
        val changed = current != resolved
        current = resolved
        if (changed) generation++
        return changed && resolved != RecordingStorageFailureKind.WriteFailed
    }
}

internal class StorageOutageEventBridge(
    private val shouldEmit: () -> Boolean,
    private val emit: () -> Unit,
) {
    fun onOutage() { if (shouldEmit()) emit() }
}

internal inline fun <T> withAvailableStorage(
    kind: RecordingStorageFailureKind?,
    action: () -> T,
): T {
    kind?.takeIf { it != RecordingStorageFailureKind.WriteFailed }?.let {
        throw StorageUnavailableException(it)
    }
    return action()
}

internal class RecordingFailureReporter(private val sink: (RecordingFailureReport) -> Unit) {
    private val reported = mutableSetOf<String>()

    fun report(operation: String, category: String, error: Throwable) {
        val report = synchronized(this) {
            if (!reported.add(operation)) return
            RecordingFailureReport(operation, category, error.javaClass.simpleName)
        }
        sink(report)
    }
}

/** Native-owned recording failure episode.
 *
 * @parity /modules/vescape-core/ios/recording/RecordingStorageFailure.swift
 * @parity /modules/vescape-core/src/index.ts `RecordingFailureState`
 */
internal object RecordingStorageFailure {
    private const val PREFS = "vescape.storage.failure"
    private const val KEY_KIND = "kind"
    private val state = StorageFailureState()
    @Volatile private var appContext: Context? = null
    @Volatile private var outageListener: (() -> Unit)? = null
    private val reportExecutor = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "vescape-storage-report").apply { isDaemon = true } }
    private var startupChecked = false
    private val reporter = RecordingFailureReporter { report ->
        Sentry.withScope { scope ->
            scope.setTag("persistence.operation", report.operation)
            scope.setTag("persistence.category", report.category)
            scope.setExtra("persistence.error_type", report.errorType)
            Sentry.captureMessage("Local persistence operation failed")
        }
    }

    fun initialize(context: Context) {
      appContext = context.applicationContext
      startupCheck(context) {
        val sqlite = TelemetryDatabase.get(context.applicationContext).openHelper.writableDatabase
        sqlite.beginTransaction()
        try {
            sqlite.execSQL("CREATE TABLE storage_startup_probe (value INTEGER NOT NULL)")
            sqlite.execSQL("INSERT INTO storage_startup_probe (value) VALUES (1)")
            sqlite.execSQL("DROP TABLE storage_startup_probe")
            sqlite.setTransactionSuccessful()
        } finally {
            sqlite.endTransaction()
        }
      }
    }

    fun observeOutage(listener: (() -> Unit)?) { outageListener = listener }

    fun startupCheck(context: Context, check: () -> Unit) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val generationAtStart = synchronized(this) {
          if (startupChecked) return
          startupChecked = true
          prefs.getString(KEY_KIND, null)?.let { saved ->
              RecordingStorageFailureKind.entries.firstOrNull { it.wireValue == saved }
          }?.let(state::record)
          state.startupGeneration()
        }
        try {
            check()
            val clear = synchronized(this) {
              state.clearAfterSuccessfulStartup(generationAtStart)
            }
            if (clear) {
              prefs.edit().remove(KEY_KIND).apply()
              synchronized(this) { state.current }?.let { prefs.edit().putString(KEY_KIND, it.wireValue).apply() }
            }
        } catch (error: Exception) {
            val classified = classify(error)
            val changed = synchronized(this) { recordFailureLocked(
              context, if (classified == RecordingStorageFailureKind.WriteFailed) RecordingStorageFailureKind.StorageUnavailable else classified
            ) }
            if (changed) notifyOutage()
        }
    }

    fun fail(context: Context, error: Exception): RecordingStorageFailureKind {
        val kind = classify(error)
        val (resolved, changed) = synchronized(this) { val resolved = resolveRecordingFailureKind(state.current, kind); resolved to recordFailureLocked(context, kind) }
        reportExecutor.execute { reporter.report("recording_commit", resolved.wireValue, error) }
        if (changed) notifyOutage()
        return resolved
    }

    private fun recordFailureLocked(
        context: Context,
        kind: RecordingStorageFailureKind,
    ): Boolean {
        // A later operation-specific failure must not hide an already established broad outage.
        val resolved = resolveRecordingFailureKind(state.current, kind)
        val changed = state.record(kind)
        if (resolved != RecordingStorageFailureKind.WriteFailed) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_KIND, resolved.wireValue).apply()
        }
        return changed
    }

    private fun notifyOutage() { outageListener?.let { Handler(Looper.getMainLooper()).post(it) } }

    /** Reports a failed read without changing the recording gate or durable failure state. */
    fun reportRead(operation: String, error: Throwable) {
        reporter.report(operation, "query_failed", error)
        enterBroadOutage(error)
    }

    fun report(operation: String, category: String, error: Throwable) {
        reporter.report(operation, category, error)
        enterBroadOutage(error)
    }

    private fun enterBroadOutage(error: Throwable) {
        val kind = classify(error)
        val context = appContext ?: return
        if (kind != RecordingStorageFailureKind.WriteFailed && error is Exception) {
            val changed = synchronized(this) { recordFailureLocked(context, kind) }
            if (changed) notifyOutage()
        }
    }

    fun value(): RecordingStorageFailureKind? = synchronized(this) { state.current }

    fun requireAvailable() {
        withAvailableStorage(value()) {}
    }

    internal fun classify(error: Throwable): RecordingStorageFailureKind = when (error) {
        is SQLiteFullException -> RecordingStorageFailureKind.FullDisk
        is SQLiteCantOpenDatabaseException,
        is SQLiteDatabaseCorruptException,
        is SQLiteDiskIOException,
        is SQLiteReadOnlyDatabaseException -> RecordingStorageFailureKind.StorageUnavailable
        else -> error.cause?.let(::classify) ?: RecordingStorageFailureKind.WriteFailed
    }
}
