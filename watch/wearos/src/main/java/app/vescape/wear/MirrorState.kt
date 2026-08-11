package app.vescape.wear

const val WATCH_FRAME_INTERVAL_MS = 250L
const val MIRROR_DISCONNECTED_TIMEOUT_MS = WATCH_FRAME_INTERVAL_MS * 3

enum class MirrorStatus {
    LIVE,
    STALE,

    /** Legacy phone frame; retained for compatibility with older phone builds. */
    WAITING,

    /** No fresh frames at all — see [PhoneLink] for why. */
    DISCONNECTED,
}

/**
 * Watch-local view of the phone link, derived by [PhoneLinkMonitor] from `NodeClient` +
 * `CapabilityClient`. Only meaningful while no frames arrive — it names the reason for the wait.
 */
enum class PhoneLink {
    UNKNOWN,

    /** No connected Wear node at all: Bluetooth link to the phone is down. */
    NO_PHONE,

    /** A phone is connected but the Vescape app capability is absent — app missing or too old. */
    PHONE_ONLY,

    /** The Vescape phone app is installed and the node is reachable; it just isn't pushing. */
    APP_REACHABLE,
}

data class MirrorState(
    val status: MirrorStatus,
    val frame: WatchFrame?,
)

object MirrorStateReducer {
    fun reduce(
        frame: WatchFrame?,
        lastFrameAtMs: Long?,
        nowMs: Long,
        timeoutMs: Long = MIRROR_DISCONNECTED_TIMEOUT_MS,
    ): MirrorState {
        if (frame == null || lastFrameAtMs == null || nowMs - lastFrameAtMs > timeoutMs) {
            return MirrorState(MirrorStatus.DISCONNECTED, null)
        }

        if (frame.waiting) {
            return MirrorState(
                MirrorStatus.WAITING,
                frame.copy(
                    speed = null,
                    duty = null,
                    battery = null,
                    motorTemp = null,
                    ctrlTemp = null,
                ),
            )
        }

        return MirrorState(
            status = if (frame.stale) MirrorStatus.STALE else MirrorStatus.LIVE,
            frame = frame,
        )
    }
}
