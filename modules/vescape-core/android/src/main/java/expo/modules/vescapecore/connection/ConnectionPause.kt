package expo.modules.vescapecore.connection

import android.content.Context
import expo.modules.vescapecore.diagnostics.ConnectionTraceEvent
import expo.modules.vescapecore.diagnostics.ConnectionTraceField
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason
import expo.modules.vescapecore.diagnostics.ConnectionWorkflow
import org.json.JSONObject

/**
 * One Automatic Connection Pause entry: a Board the rider deliberately stopped, and the absolute
 * moment automatic connection may resume for it (ADR 0035).
 *
 * @parity /modules/vescape-core/ios/connection/ConnectionPause.swift `ConnectionPause`
 * @parity /modules/vescape-core/src/index.ts `ConnectionPauseState`
 */
data class ConnectionPause(
    val boardId: String,
    /** Absolute deadline. Expiry is by clock comparison, so no cleanup job exists. */
    val untilMs: Long,
    /** Rider action that armed it, from [ConnectionTraceReason]. */
    val source: String,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "boardId" to boardId,
        "until" to untilMs,
        "source" to source,
    )
}

/**
 * Pure rules of the board-scoped Automatic Connection Pause map (ADR 0035, #406). This replaces the
 * permanent manual-stop tombstone and the separate Auto Start restart gate: one map, one deadline
 * per Board, shared by Auto Connect and Android Auto Start.
 *
 * Rider intent arms a pause; mechanics never do. Mechanical teardown, Board switch cleanup, probe
 * cancellation, Stop search, and scan timeout are deliberately absent from [ARMING_SOURCES].
 *
 * @parity /modules/vescape-core/ios/connection/ConnectionPause.swift `ConnectionPausePolicy`
 */
object ConnectionPausePolicy {
    /** Legacy values up to 24h stay valid; only the rider-facing stepper recommends less. */
    const val MAX_PAUSE_MINUTES = 1440

    /** Cap offered for *new* selections. Stored values above it are preserved, never clamped. */
    const val RECOMMENDED_MAX_PAUSE_MINUTES = 480

    /** The four rider actions that arm a pause. Everything else is mechanics. */
    val ARMING_SOURCES: Set<String> = setOf(
        ConnectionTraceReason.MANUAL_DISCONNECT,
        ConnectionTraceReason.END_RIDE,
        ConnectionTraceReason.APP_EXIT,
        ConnectionTraceReason.TASK_REMOVED,
    )

    fun arms(source: String): Boolean = source in ARMING_SOURCES

    /** Absolute deadline for a pause armed now, or `null` when the rider configured zero minutes. */
    fun deadlineFor(nowMs: Long, minutes: Int): Long? =
        if (minutes <= 0) null else nowMs + minutes * 60_000L

    fun isActive(pause: ConnectionPause, nowMs: Long): Boolean = pause.untilMs > nowMs

    /** The still-running pause for [boardId], or `null` when it never existed or already expired. */
    fun active(entries: Map<String, ConnectionPause>, boardId: String?, nowMs: Long): ConnectionPause? {
        if (boardId.isNullOrBlank()) return null
        return entries[boardId]?.takeIf { isActive(it, nowMs) }
    }

    /** Drop expired entries. Returns the same instance when nothing expired. */
    fun prune(entries: Map<String, ConnectionPause>, nowMs: Long): Map<String, ConnectionPause> {
        val kept = entries.filterValues { isActive(it, nowMs) }
        return if (kept.size == entries.size) entries else kept
    }
}

/**
 * Where the Automatic Connection Pause map is kept. The one Android-typed line of the feature, so
 * the map's arm/clear/expire semantics stay unit-testable without a device.
 *
 * iOS reaches the same seam by injecting `UserDefaults` into `ConnectionPauseStore`.
 */
internal interface ConnectionPauseStorage {
    fun load(): String?

    fun save(value: String?)
}

/**
 * The Automatic Connection Pause map itself: arm, clear, and read entries by Board id, persisted as
 * JSON through [ConnectionPauseStorage]. Expiry happens on read, so no cleanup job exists.
 *
 * @parity /modules/vescape-core/ios/connection/ConnectionPause.swift `ConnectionPauseStore`
 */
internal class ConnectionPauseRegistry(
    private val storage: ConnectionPauseStorage,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /**
     * Arm a pause for [boardId]. Returns `null` — and stores nothing — when [source] is not a rider
     * action, or when the configured duration is zero (the rider opted out of pausing).
     */
    @Synchronized
    fun arm(
        boardId: String?,
        source: String,
        minutes: Int,
        workflow: ConnectionWorkflow? = null,
    ): ConnectionPause? {
        if (boardId.isNullOrBlank() || !ConnectionPausePolicy.arms(source)) return null
        val now = clock()
        val until = ConnectionPausePolicy.deadlineFor(now, minutes) ?: run {
            workflow?.event(
                ConnectionTraceEvent.PAUSE_BLOCKED,
                mapOf(
                    ConnectionTraceField.BOARD_ID to boardId,
                    ConnectionTraceField.PAUSE_SOURCE to source,
                    ConnectionTraceField.DEADLINE_MS to 0L,
                ),
            )
            return null
        }
        val pause = ConnectionPause(boardId = boardId, untilMs = until, source = source)
        write(ConnectionPausePolicy.prune(read(), now) + (boardId to pause))
        workflow?.event(
            ConnectionTraceEvent.PAUSE_STARTED,
            mapOf(
                ConnectionTraceField.BOARD_ID to boardId,
                ConnectionTraceField.PAUSE_SOURCE to source,
                ConnectionTraceField.PAUSED_UNTIL to until,
            ),
        )
        return pause
    }

    /** Explicit Connect, Connect now, and Switch & Connect clear the affected Board's pause. */
    @Synchronized
    fun clear(boardId: String?, workflow: ConnectionWorkflow? = null) {
        if (boardId.isNullOrBlank()) return
        val entries = read()
        val existing = entries[boardId] ?: return
        write(entries - boardId)
        workflow?.event(
            ConnectionTraceEvent.PAUSE_CLEARED,
            mapOf(
                ConnectionTraceField.BOARD_ID to boardId,
                ConnectionTraceField.PAUSE_SOURCE to existing.source,
                ConnectionTraceField.PAUSED_UNTIL to existing.untilMs,
            ),
        )
    }

    /** The running pause for [boardId]. Expired entries are dropped here — no cleanup job. */
    @Synchronized
    fun active(boardId: String?, workflow: ConnectionWorkflow? = null): ConnectionPause? {
        if (boardId.isNullOrBlank()) return null
        val now = clock()
        val entries = read()
        val stored = entries[boardId] ?: return null
        if (ConnectionPausePolicy.isActive(stored, now)) return stored
        write(ConnectionPausePolicy.prune(entries, now))
        workflow?.event(
            ConnectionTraceEvent.PAUSE_EXPIRED,
            mapOf(
                ConnectionTraceField.BOARD_ID to boardId,
                ConnectionTraceField.PAUSE_SOURCE to stored.source,
                ConnectionTraceField.PAUSED_UNTIL to stored.untilMs,
            ),
        )
        return null
    }

    /** Deadline feeding [PresencePromotionInput.pausedUntilMs], or `null` when not paused. */
    fun pausedUntilMs(boardId: String?, workflow: ConnectionWorkflow? = null): Long? =
        active(boardId, workflow)?.untilMs

    @Synchronized
    fun entries(): Map<String, ConnectionPause> = read()

    @Synchronized
    fun clearAll() {
        storage.save(null)
    }

    private fun read(): Map<String, ConnectionPause> {
        val raw = storage.load() ?: return emptyMap()
        return try {
            val json = JSONObject(raw)
            buildMap {
                for (boardId in json.keys()) {
                    val entry = json.optJSONObject(boardId) ?: continue
                    val until = entry.optLong(FIELD_UNTIL, 0L)
                    val source = entry.optString(FIELD_SOURCE).takeIf { it.isNotBlank() } ?: continue
                    if (until <= 0L) continue
                    put(boardId, ConnectionPause(boardId, until, source))
                }
            }
        } catch (_: Exception) {
            // A corrupt map must not permanently block automatic connection: fail open, not shut.
            emptyMap()
        }
    }

    private fun write(entries: Map<String, ConnectionPause>) {
        if (entries.isEmpty()) {
            storage.save(null)
            return
        }
        val json = JSONObject()
        for ((boardId, pause) in entries) {
            json.put(
                boardId,
                JSONObject().put(FIELD_UNTIL, pause.untilMs).put(FIELD_SOURCE, pause.source),
            )
        }
        storage.save(json.toString())
    }

    private companion object {
        const val FIELD_UNTIL = "until"
        const val FIELD_SOURCE = "source"
    }
}

/**
 * Process-wide Automatic Connection Pause map, persisted in SharedPreferences. It survives process
 * death and reboot, because the whole point is that force-quitting the app does not re-arm automatic
 * connection.
 *
 * Every entry point takes a Board id explicitly, never "the selected Board": Android Auto Start
 * (#407) evaluates the *detected* Board, and Switch & Connect (#408) clears the *target* Board.
 *
 * @parity /modules/vescape-core/ios/connection/ConnectionPause.swift `ConnectionPauseStore`
 */
object ConnectionPauseStore {
    const val PREFS = "vesc_automatic_connection_pause"
    private const val KEY_ENTRIES = "entries"

    fun arm(
        context: Context,
        boardId: String?,
        source: String,
        minutes: Int,
        workflow: ConnectionWorkflow? = null,
    ): ConnectionPause? = registry(context).arm(boardId, source, minutes, workflow)

    fun clear(context: Context, boardId: String?, workflow: ConnectionWorkflow? = null) =
        registry(context).clear(boardId, workflow)

    fun active(
        context: Context,
        boardId: String?,
        workflow: ConnectionWorkflow? = null,
    ): ConnectionPause? = registry(context).active(boardId, workflow)

    fun pausedUntilMs(
        context: Context,
        boardId: String?,
        workflow: ConnectionWorkflow? = null,
    ): Long? = registry(context).pausedUntilMs(boardId, workflow)

    fun entries(context: Context): Map<String, ConnectionPause> = registry(context).entries()

    private fun registry(context: Context) = ConnectionPauseRegistry(
        object : ConnectionPauseStorage {
            private val prefs =
                context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

            override fun load(): String? = prefs.getString(KEY_ENTRIES, null)

            override fun save(value: String?) {
                val editor = prefs.edit()
                if (value == null) editor.remove(KEY_ENTRIES) else editor.putString(KEY_ENTRIES, value)
                editor.apply()
            }
        },
    )
}
