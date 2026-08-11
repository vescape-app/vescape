package app.vescape.wear

/** Cadence assumed until two frames have been seen; matches the phone's default push interval. */
const val WATCH_FRAME_INTERVAL_MS = 250L

/**
 * Three missed frames means disconnected. The phone's push cadence is a rider setting
 * (`wearMirrorIntervalMs`, 50–10000 ms), so the window is measured from the frames that actually
 * arrive rather than assumed — a hardcoded window pins the mirror to DISCONNECTED on every cadence
 * the rider picks above the default. Clamped so neither a burst nor a long stall distorts it.
 */
const val MIRROR_DISCONNECTED_MIN_TIMEOUT_MS = 750L
const val MIRROR_DISCONNECTED_MAX_TIMEOUT_MS = 30_000L

fun mirrorDisconnectedTimeoutMs(frameGapMs: Long?): Long =
    ((frameGapMs ?: WATCH_FRAME_INTERVAL_MS) * 3)
        .coerceIn(MIRROR_DISCONNECTED_MIN_TIMEOUT_MS, MIRROR_DISCONNECTED_MAX_TIMEOUT_MS)

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
        timeoutMs: Long = mirrorDisconnectedTimeoutMs(null),
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
