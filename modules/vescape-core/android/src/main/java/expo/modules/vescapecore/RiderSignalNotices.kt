package expo.modules.vescapecore

import expo.modules.vescapecore.notices.RideNoticeContent
import expo.modules.vescapecore.notices.RideNoticeLocation
import expo.modules.vescapecore.notices.RideNoticeSeverity

/** A roster Rider as [RiderSignalNotices] sees it. */
internal data class SignalRider(val id: String, val name: String, val signal: RiderSignal?)

/**
 * Maps the joined ride's roster to the Ride Notices of other Riders' active signals, one per Rider
 * under `riderSignal:<riderId>`. Pure: the observer applies the returned [Update] to `RideNotices`.
 *
 * Signal times are relay epoch ms; notices run on the phone clock. Each signal is converted once,
 * when its `startedAt` is first seen, with the offset `localNow - relayNow` of that roster (no
 * offset when the roster has no `now`). Pinning keeps a re-sent roster an identical, no-op post
 * instead of jittering by network latency. `revision = startedAt`: a new kind or a re-send shows a
 * dismissed notice again, a rename does not.
 *
 * @parity /modules/vescape-core/ios/groupride/RiderSignalNotices.swift `RiderSignalNotices`
 */
internal class RiderSignalNotices {
    data class Post(val key: String, val content: RideNoticeContent, val revision: String)
    data class Update(val posts: List<Post>, val clears: List<String>)

    private class Pinned(val startedAt: Long, val postedAt: Long, val expiresAt: Long)

    /** Rider id → the local times of the signal its notice was posted for. */
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

    /** The ride is over for this rider: every posted notice key, to clear. */
    fun reset(): List<String> = posted.keys.map(::key).also { posted.clear() }

    companion object {
        private const val KEY_PREFIX = "riderSignal:"

        fun key(riderId: String) = KEY_PREFIX + riderId

        private fun content(name: String, signal: RiderSignal, pinned: Pinned) = RideNoticeContent(
            severity = if (signal.kind.critical) RideNoticeSeverity.CRITICAL else RideNoticeSeverity.WARNING,
            title = "${name.ifBlank { "Rider" }}: ${signal.kind.label}",
            // The card renders "N min ago" from postedAt.
            details = "",
            postedAt = pinned.postedAt,
            location = RideNoticeLocation(signal.lat, signal.lng),
            expiresAt = pinned.expiresAt,
        )
    }
}
