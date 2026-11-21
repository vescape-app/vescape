package expo.modules.vescapecore

import expo.modules.vescapecore.notices.RideNoticeContent
import expo.modules.vescapecore.notices.RideNoticeLocation

internal data class SignalRider(val id: String, val name: String, val signal: RiderSignal?)

/**
 * @parity /modules/vescape-core/ios/groupride/RiderSignalNotices.swift `RiderSignalNotices`
 */
internal class RiderSignalNotices {
    data class Post(val key: String, val content: RideNoticeContent, val revision: String)
    data class Update(val posts: List<Post>, val clears: List<String>)

    private class Pinned(val startedAt: Long, val postedAt: Long, val expiresAt: Long)

    private val posted = mutableMapOf<String, Pinned>()

    fun roster(riders: List<SignalRider>, ownRiderId: String?, relayNow: Long?, localNow: Long): Update {
        val offset = relayNow?.let { localNow - it } ?: 0L
        val posts = riders.mapNotNull { rider ->
            val signal = rider.signal ?: return@mapNotNull null
            if (rider.id == ownRiderId) return@mapNotNull null
            val pinned = posted[rider.id]?.takeIf { it.startedAt == signal.startedAt }
                ?: Pinned(signal.startedAt, signal.startedAt + offset, signal.expiresAt + offset)
            posted[rider.id] = pinned
            Post(key(rider.id), content(rider.name, signal, pinned), signal.startedAt.toString())
        }
        val active = posts.map { it.key }.toSet()
        val gone = posted.keys.filter { key(it) !in active }
        gone.forEach(posted::remove)
        return Update(posts, gone.map(::key))
    }

    fun reset(): List<String> = posted.keys.map(::key).also { posted.clear() }

    companion object {
        private const val KEY_PREFIX = "riderSignal:"

        /** @parity /src/modules/group-ride/lib/riderSignalNotice.ts `KEY_PREFIX` */
        fun key(riderId: String) = KEY_PREFIX + riderId

        private fun content(name: String, signal: RiderSignal, pinned: Pinned) = RideNoticeContent(
            severity = signal.kind.severity,
            title = "${name.ifBlank { "Rider" }}: ${signal.kind.label}",
            details = "",
            postedAt = pinned.postedAt,
            location = RideNoticeLocation(signal.lat, signal.lng),
            expiresAt = pinned.expiresAt,
        )
    }
}
