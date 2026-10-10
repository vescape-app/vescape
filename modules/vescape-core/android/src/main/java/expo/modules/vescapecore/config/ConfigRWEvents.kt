package expo.modules.vescapecore.config

import expo.modules.vescapecore.connection.BoardTransport

internal sealed class ConfigRWEvent {
    data class StartRead(
        val opId: String,
        val canId: Int?,
        val transport: BoardTransport,
        val wasPolling: Boolean,
        val appBoardId: String?,
        val fwVersion: String?,
        val refloatBaseVersion: String?,
    ) : ConfigRWEvent()

    data class StartWrite(
        val opId: String,
        val canId: Int?,
        val transport: BoardTransport,
        val wasPolling: Boolean,
        val profileFields: Map<String, Any>,
        val appBoardId: String?,
        val fwVersion: String?,
        val refloatBaseVersion: String?,
        /** Refloat version the trusted Board Link observed; seeds the snapshot this write returns. */
        val refloatVersion: String?,
        /**
         * The session's fresh write base, when it holds one. Present means the write patches these
         * retained bytes directly instead of reading the board first (ADR 0035).
         */
        val writeBase: BoardConfigWriteBase?,
    ) : ConfigRWEvent()

    data class XmlPayloadReceived(val payload: ByteArray) : ConfigRWEvent()

    data class InfoPayloadReceived(val payload: ByteArray) : ConfigRWEvent()

    data class ConfigBytesPayloadReceived(
        val payload: ByteArray,
        val capturedAtMs: Long,
    ) : ConfigRWEvent()

    data class SetConfigResponseReceived(val payload: ByteArray) : ConfigRWEvent()

    data class Timeout(val code: RefloatConfigErrorCode) : ConfigRWEvent()

    data class GattWriteFailed(val message: String) : ConfigRWEvent()

    data class SessionTerminated(val reason: String) : ConfigRWEvent()
}
