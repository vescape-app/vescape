package expo.modules.vescapecore.notices

/** Ordered most urgent first; the order is the sort order. */
enum class RideNoticeSeverity(val wire: String) {
    CRITICAL("critical"),
    WARNING("warning"),
    INFO("info");

    companion object {
        fun fromWire(value: String?): RideNoticeSeverity? = entries.firstOrNull { it.wire == value }
    }
}

data class RideNoticeLocation(val lat: Double, val lng: Double)

/** What a source posts. `postedAt` and `expiresAt` are source-supplied epoch ms. */
data class RideNoticeContent(
    val severity: RideNoticeSeverity,
    val title: String,
    val details: String,
    val postedAt: Long,
    val location: RideNoticeLocation? = null,
    val expiresAt: Long? = null,
)

/**
 * One visible Ride Notice. `id` (1–255) and `rev` (1–255, wraps) each fit one byte, so the watch can
 * address and version a notice in a `[kind, id, rev]` command.
 *
 * @parity /modules/vescape-core/ios/notices/RideNoticeEngine.swift `RideNotice`
 * @parity /modules/vescape-core/src/index.ts `RideNotice`
 */
data class RideNotice(val id: Int, val rev: Int, val key: String, val content: RideNoticeContent) {
    fun toMap(): Map<String, Any?> = mapOf(
        "id" to id,
        "rev" to rev,
        "key" to key,
        "severity" to content.severity.wire,
        "title" to content.title,
        "details" to content.details,
        "postedAt" to content.postedAt,
        "location" to content.location?.let { mapOf("lat" to it.lat, "lng" to it.lng) },
        "expiresAt" to content.expiresAt,
    )
}

/**
 * The Ride Notice table. Pure: no clock, no threads, no platform types, so every rule is unit
 * tested. Each mutation reports whether the visible list changed; callers emit only then.
 *
 * - A post with the same `revision` updates content in place and keeps a dismissed notice hidden.
 *   A new `revision` bumps `rev` and shows it again.
 * - A dismiss names `(id, rev)`; a stale `rev` is ignored, so a re-sent revision is never hidden unseen.
 * - A dismissed notice keeps its key and id until the source clears it or it expires.
 * - Ids are allocated round-robin over 1–255, skipping ids in use; a full table drops the post.
 *
 * @parity /modules/vescape-core/ios/notices/RideNoticeEngine.swift `RideNoticeEngine`
 */
class RideNoticeEngine {
    enum class PostResult { CHANGED, UNCHANGED, DROPPED }

    private class Entry(
        val id: Int,
        var rev: Int,
        var revision: String,
        var content: RideNoticeContent,
        var dismissed: Boolean,
    )

    private val entries = LinkedHashMap<String, Entry>()
    private var lastId = 0

    /** Visible notices: severity first, then newest `postedAt`. */
    var active: List<RideNotice> = emptyList()
        private set

    fun post(key: String, content: RideNoticeContent, revision: String, nowMs: Long): PostResult {
        if (content.expiresAt != null && content.expiresAt <= nowMs) {
            return if (clear(key)) PostResult.CHANGED else PostResult.UNCHANGED
        }
        val existing = entries[key]
        when {
            existing == null -> {
                val id = allocateId() ?: return PostResult.DROPPED
                entries[key] = Entry(id, 1, revision, content, dismissed = false)
            }
            existing.revision == revision -> existing.content = content
            else -> {
                existing.revision = revision
                existing.rev = existing.rev % MAX_ID + 1
                existing.content = content
                existing.dismissed = false
            }
        }
        return if (refresh()) PostResult.CHANGED else PostResult.UNCHANGED
    }

    fun clear(key: String): Boolean = entries.remove(key) != null && refresh()

    /**
     * Hide the notice holding [id] at [rev]. A mismatched [rev] is a dismiss aimed at a revision the
     * rider never saw (the source re-posted in between), so it is ignored.
     */
    fun dismiss(id: Int, rev: Int): Boolean {
        val entry = entries.values.firstOrNull { it.id == id && it.rev == rev && !it.dismissed } ?: return false
        entry.dismissed = true
        return refresh()
    }

    /** Drops expired notices silently, dismissed or not. */
    fun tick(nowMs: Long): Boolean {
        val removed = entries.values.removeAll { entry -> entry.content.expiresAt?.let { it <= nowMs } == true }
        return removed && refresh()
    }

    /** Earliest `expiresAt` in the table, for the caller's next [tick]. */
    fun nextExpiryAt(): Long? = entries.values.mapNotNull { it.content.expiresAt }.minOrNull()

    private fun allocateId(): Int? {
        val used = entries.values.mapTo(HashSet()) { it.id }
        for (step in 1..MAX_ID) {
            val candidate = (lastId + step - 1) % MAX_ID + 1
            if (candidate !in used) {
                lastId = candidate
                return candidate
            }
        }
        return null
    }

    private fun refresh(): Boolean {
        val next = entries.entries
            .filter { !it.value.dismissed }
            .map { (key, entry) -> RideNotice(entry.id, entry.rev, key, entry.content) }
            .sortedWith(
                compareBy<RideNotice> { it.content.severity.ordinal }
                    .thenByDescending { it.content.postedAt }
                    .thenBy { it.id },
            )
        if (next == active) return false
        active = next
        return true
    }

    companion object {
        const val MAX_ID = 255
    }
}
