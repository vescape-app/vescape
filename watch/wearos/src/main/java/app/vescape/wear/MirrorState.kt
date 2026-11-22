package app.vescape.wear

const val WATCH_FRAME_INTERVAL_MS = 250L

const val MIRROR_DISCONNECTED_MIN_TIMEOUT_MS = 750L
const val MIRROR_DISCONNECTED_MAX_TIMEOUT_MS = 30_000L

/**
 * @parity /modules/vescape-core/ios/watch/MirrorState.swift `cadenceWindowGaps`
 */
const val MIRROR_CADENCE_WINDOW_GAPS = 8

fun mirrorDisconnectedTimeoutMs(frameGapMs: Long?): Long =
    ((frameGapMs ?: WATCH_FRAME_INTERVAL_MS) * 3)
        .coerceIn(MIRROR_DISCONNECTED_MIN_TIMEOUT_MS, MIRROR_DISCONNECTED_MAX_TIMEOUT_MS)

/** @parity /modules/vescape-core/ios/watch/MirrorState.swift `MirrorStatus` */
enum class MirrorStatus {
    LIVE,
    STALE,

    WAITING,

    DISCONNECTED,
}

/** @parity /modules/vescape-core/ios/watch/MirrorState.swift `MirrorPhoneLink` */
enum class PhoneLink {
    UNKNOWN,

    NO_PHONE,

    PHONE_ONLY,

    APP_REACHABLE,
}

/**
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
