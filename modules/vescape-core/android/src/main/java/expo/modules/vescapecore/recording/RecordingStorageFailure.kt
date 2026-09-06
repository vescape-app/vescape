package expo.modules.vescapecore.recording

import android.content.Context
import android.database.sqlite.SQLiteCantOpenDatabaseException
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteFullException
import android.database.sqlite.SQLiteReadOnlyDatabaseException
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

internal class RecordingFailureReporter(private val sink: (RecordingFailureReport) -> Unit) {
    private val reported = mutableSetOf<String>()

    @Synchronized fun report(operation: String, category: String, error: Throwable) {
        if (!reported.add(operation)) return
        sink(RecordingFailureReport(operation, category, error.javaClass.simpleName))
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
    @Volatile private var current: RecordingStorageFailureKind? = null
    private var startupChecked = false
    private val reporter = RecordingFailureReporter { report ->
        Sentry.withScope { scope ->
            scope.setTag("persistence.operation", report.operation)
            scope.setTag("persistence.category", report.category)
            scope.setExtra("persistence.error_type", report.errorType)
            Sentry.captureMessage("Local persistence operation failed")
        }
    }

    fun initialize(context: Context) = startupCheck(context) {
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

    @Synchronized fun startupCheck(context: Context, check: () -> Unit) {
        if (startupChecked) return
        startupChecked = true
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        current = prefs.getString(KEY_KIND, null)?.let { saved ->
            RecordingStorageFailureKind.entries.firstOrNull { it.wireValue == saved }
        }
        try {
            check()
            prefs.edit().remove(KEY_KIND).apply()
            current = null
        } catch (error: Exception) {
            val classified = classify(error)
            recordFailure(
                context,
                error,
                if (classified == RecordingStorageFailureKind.WriteFailed) RecordingStorageFailureKind.StorageUnavailable else classified,
            )
        }
    }

    @Synchronized fun fail(context: Context, error: Exception): RecordingStorageFailureKind {
        val kind = classify(error)
        return recordFailure(context, error, kind)
    }

    private fun recordFailure(
        context: Context,
        error: Exception,
        kind: RecordingStorageFailureKind,
    ): RecordingStorageFailureKind {
        // A later operation-specific failure must not hide an already established broad outage.
        val resolved = resolveRecordingFailureKind(current, kind)
        current = resolved
        if (resolved != RecordingStorageFailureKind.WriteFailed) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_KIND, resolved.wireValue).apply()
        }
        reporter.report("recording_commit", resolved.wireValue, error)
        return resolved
    }

    /** Reports a failed read without changing the recording gate or durable failure state. */
    fun reportRead(operation: String, error: Throwable) {
        reporter.report(operation, "query_failed", error)
    }

    fun report(operation: String, category: String, error: Throwable) {
        reporter.report(operation, category, error)
    }

    fun value(): RecordingStorageFailureKind? = current

    internal fun classify(error: Throwable): RecordingStorageFailureKind = when (error) {
        is SQLiteFullException -> RecordingStorageFailureKind.FullDisk
        is SQLiteCantOpenDatabaseException,
        is SQLiteDatabaseCorruptException,
        is SQLiteDiskIOException,
        is SQLiteReadOnlyDatabaseException -> RecordingStorageFailureKind.StorageUnavailable
        else -> error.cause?.let(::classify) ?: RecordingStorageFailureKind.WriteFailed
    }
}
