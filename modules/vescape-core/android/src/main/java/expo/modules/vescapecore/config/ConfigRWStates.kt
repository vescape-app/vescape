package expo.modules.vescapecore.config

import expo.modules.vescapecore.connection.BoardTransport

internal data class ReadContext(
    val opId: String,
    val canId: Int?,
    val transport: BoardTransport,
    val wasPolling: Boolean,
    val appBoardId: String?,
    val fwVersion: String?,
    /** Refloat base version of the connected board — the Board Config Values cache scope (ADR 0022). */
    val refloatBaseVersion: String? = null,
    val refloatVersion: String? = null,
)

internal data class WriteContext(
    val opId: String,
    val canId: Int?,
    val transport: BoardTransport,
    val wasPolling: Boolean,
    val profileFields: Map<String, Any>,
    val appBoardId: String?,
    val fwVersion: String?,
    /** Refloat base version of the connected board — the Board Config Values cache scope (ADR 0022). */
    val refloatBaseVersion: String? = null,
    val refloatVersion: String? = null,
)

internal sealed class ConfigRWState {
    object Idle : ConfigRWState()

    data class ReadCollectingXml(
        val ctx: ReadContext,
        val xmlBytes: ByteArray,
        val expectedXmlLength: Int?,
        val nextOffset: Int,
    ) : ConfigRWState()

    data class ReadAwaitingConfig(
        val ctx: ReadContext,
        val xmlBytes: ByteArray,
    ) : ConfigRWState()

    data class WriteCollectingXml(
        val ctx: WriteContext,
        val xmlBytes: ByteArray,
        val expectedXmlLength: Int?,
        val nextOffset: Int,
    ) : ConfigRWState()

    data class WriteAwaitingConfig(
        val ctx: WriteContext,
        val xmlBytes: ByteArray,
    ) : ConfigRWState()

    data class WriteAwaitingSetAck(
        val ctx: WriteContext,
        val schema: RefloatConfigSchema,
        val originalConfig: ByteArray,
        val patchedConfig: ByteArray,
    ) : ConfigRWState()

    data class WriteVerifying(
        val ctx: WriteContext,
        val schema: RefloatConfigSchema,
        val originalConfig: ByteArray,
        val patchedConfig: ByteArray,
    ) : ConfigRWState()
}

internal enum class ConfigWritePhaseTag {
    READING_SCHEMA,
    READING_CONFIG,
    SENDING_WRITE,
    VERIFYING;

    companion object {
        fun of(state: ConfigRWState): ConfigWritePhaseTag = when (state) {
            is ConfigRWState.WriteCollectingXml -> READING_SCHEMA
            is ConfigRWState.WriteAwaitingConfig -> READING_CONFIG
            is ConfigRWState.WriteAwaitingSetAck -> SENDING_WRITE
            is ConfigRWState.WriteVerifying -> VERIFYING
            else -> READING_SCHEMA
        }
    }
}
