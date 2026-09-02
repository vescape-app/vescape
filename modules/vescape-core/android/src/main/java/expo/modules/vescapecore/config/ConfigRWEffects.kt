package expo.modules.vescapecore.config

internal sealed class ConfigRWEffect {
    data class SendFrame(val payload: ByteArray) : ConfigRWEffect()

    data class ScheduleTimeout(
        val code: RefloatConfigErrorCode,
        val timeoutMs: Long,
    ) : ConfigRWEffect()

    object CancelTimeout : ConfigRWEffect()

    data class EmitReadComplete(
        val snapshot: RefloatConfigSnapshot,
        val resumePolling: Boolean,
        val boardConfigValues: BoardConfigValues?,
    ) : ConfigRWEffect()

    data class EmitReadFailure(
        val code: RefloatConfigErrorCode,
        val message: String,
        val opId: String,
        val resumePolling: Boolean,
        val rawConfig: ByteArray?,
    ) : ConfigRWEffect()

    data class EmitWriteComplete(
        val snapshot: RefloatConfigSnapshot,
        val resumePolling: Boolean,
        val boardConfigValues: BoardConfigValues?,
    ) : ConfigRWEffect()

    data class EmitWriteFailure(
        val code: RefloatConfigErrorCode,
        val message: String,
        val opId: String,
        val resumePolling: Boolean,
        val phase: ConfigWritePhaseTag,
        val rawConfig: ByteArray?,
    ) : ConfigRWEffect()

    data class DumpDebugBytes(
        val xmlBytes: ByteArray,
        val configBytes: ByteArray,
    ) : ConfigRWEffect()
}
