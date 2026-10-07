package app.vescape.wear

/** Cadence assumed until two frames have been seen; matches the phone's default push interval. */
const val WATCH_FRAME_INTERVAL_MS = 250L

/**
 * Three missed frames means disconnected. The phone's push cadence is a rider setting
 * (`wearPushRateHz`, 1–20 Hz), so the window is measured from the frames that actually
 * arrive rather than assumed — a hardcoded window pins the mirror to DISCONNECTED on every cadence
 * the rider picks above the default. Clamped so neither a burst nor a long stall distorts it.
 */
const val MIRROR_DISCONNECTED_MIN_TIMEOUT_MS = 750L
const val MIRROR_DISCONNECTED_MAX_TIMEOUT_MS = 30_000L

/**
 * How many recent arrival gaps the cadence is read from. The window is sized by the longest of them,
 * never the last: transports deliver in bursts, so the last gap inside a burst is ~0 and would shrink
 * the window to the floor, flipping the mirror to DISCONNECTED in every pause between bursts.
 *
 * @parity /modules/vescape-core/ios/watch/MirrorState.swift `cadenceWindowGaps`
 */
const val MIRROR_CADENCE_WINDOW_GAPS = 8

/** [frameGapMs] is the longest recent arrival gap (see [MIRROR_CADENCE_WINDOW_GAPS]). */
fun mirrorDisconnectedTimeoutMs(frameGapMs: Long?): Long =
    ((frameGapMs ?: WATCH_FRAME_INTERVAL_MS) * 3)
        .coerceIn(MIRROR_DISCONNECTED_MIN_TIMEOUT_MS, MIRROR_DISCONNECTED_MAX_TIMEOUT_MS)

/** @parity /modules/vescape-core/ios/watch/MirrorState.swift `MirrorStatus` */
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
/** @parity /modules/vescape-core/ios/watch/MirrorState.swift `MirrorPhoneLink` */
enum class PhoneLink {
    UNKNOWN,

    /** No connected Wear node at all: Bluetooth link to the phone is down. */
    NO_PHONE,

    /** A phone is connected but the Vescape app capability is absent — app missing or too old. */
    PHONE_ONLY,

    /** The Vescape phone app is installed and the node is reachable; it just isn't pushing. */
    APP_REACHABLE,
}

/**
 * What the gauge shell says while no frames arrive: only the phone-link problems the wrist cannot fix
 * itself. A reachable phone app that is not pushing has nothing to say — no Board is not a fault,
 * the rider may be on foot in a Group Ride or navigating (ADR-0039) — so it gets no notice and the
 * shell reads exactly as it does for a board-less frame.
 *
 * @parity /modules/vescape-core/ios/watch/MirrorState.swift `MirrorLinkNotice`
 */
enum class LinkNotice {
    CONNECTING,
    NO_PHONE,
    APP_MISSING,
}

/** @parity /modules/vescape-core/ios/watch/MirrorState.swift `MirrorState` */
data class MirrorState(
    val status: MirrorStatus,
    val frame: WatchFrame?,
)

/** @parity /modules/vescape-core/ios/watch/MirrorState.swift `MirrorStateReducer` */
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

    /**
     * The notice for [status] given the watch-local [link]; null means the shell says nothing.
     *
     * @parity /modules/vescape-core/ios/watch/MirrorState.swift `linkNotice`
     */
    fun linkNotice(status: MirrorStatus, link: PhoneLink): LinkNotice? {
        if (status != MirrorStatus.DISCONNECTED) return null
        return when (link) {
            PhoneLink.UNKNOWN -> LinkNotice.CONNECTING
            PhoneLink.NO_PHONE -> LinkNotice.NO_PHONE
            PhoneLink.PHONE_ONLY -> LinkNotice.APP_MISSING
            PhoneLink.APP_REACHABLE -> null
        }
    }
}
