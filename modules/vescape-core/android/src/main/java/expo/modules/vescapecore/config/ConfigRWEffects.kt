package expo.modules.vescapecore.config

internal sealed class ConfigRWEffect {
    data class SendFrame(
        val payload: ByteArray,
        val requiresIdleBoard: Boolean = false,
    ) : ConfigRWEffect()

    data class ScheduleTimeout(
        val code: RefloatConfigErrorCode,
        val timeoutMs: Long,
    ) : ConfigRWEffect()

    object CancelTimeout : ConfigRWEffect()

    object DemoteWriteBase : ConfigRWEffect()

    data class EmitReadComplete(
        val boardConfigValues: BoardConfigValues,
        val resumePolling: Boolean,
    ) : ConfigRWEffect()

    data class EmitReadFailure(
        val code: RefloatConfigErrorCode,
        val message: String,
        val opId: String,
        val resumePolling: Boolean,
        val rawConfig: ByteArray?,
    ) : ConfigRWEffect()

    data class EmitWriteComplete(
        val boardConfigValues: BoardConfigValues,
        val resumePolling: Boolean,
        val origin: BoardConfigOperationOrigin = BoardConfigOperationOrigin.VESCAPE_WRITE,
        val emitBoardConfigValues: Boolean = true,
    ) : ConfigRWEffect()

    data class EmitWriteFailure(
        val code: RefloatConfigErrorCode,
        val message: String,
        val opId: String,
        val resumePolling: Boolean,
        val phase: ConfigWritePhaseTag,
        val rawConfig: ByteArray?,
        val demotedWriteBase: Boolean = false,
    ) : ConfigRWEffect()

    data class DumpDebugBytes(
        val xmlBytes: ByteArray,
        val configBytes: ByteArray,
    ) : ConfigRWEffect()
}
