package expo.modules.vescapecore.config

import expo.modules.vescapecore.connection.BoardTransport

internal const val CONFIG_CHUNK_LENGTH = 384
internal const val CONFIG_SCHEMA_TIMEOUT_MS = 10_000L
internal const val CONFIG_READ_TIMEOUT_MS = 8_000L
internal const val CONFIG_WRITE_TIMEOUT_MS = 10_000L

internal object ConfigRWFsm {
    fun apply(
        state: ConfigRWState,
        event: ConfigRWEvent,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> = when (event) {
        is ConfigRWEvent.StartRead -> onStartRead(state, event)
        is ConfigRWEvent.StartWrite -> onStartWrite(state, event)
        is ConfigRWEvent.InfoPayloadReceived -> onInfo(state, event)
        is ConfigRWEvent.XmlPayloadReceived -> onXml(state, event)
        is ConfigRWEvent.ConfigBytesPayloadReceived -> onConfigBytes(state, event)
        is ConfigRWEvent.SetConfigResponseReceived -> onSetAck(state, event)
        is ConfigRWEvent.Timeout -> onTimeout(state, event)
        is ConfigRWEvent.GattWriteFailed -> onGattFailed(state, event)
        is ConfigRWEvent.SessionTerminated -> onSessionTerminated(state, event)
    }

    private fun onStartRead(
        state: ConfigRWState,
        event: ConfigRWEvent.StartRead,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        if (state !is ConfigRWState.Idle) return state to emptyList()
        val ctx = ReadContext(
            opId = event.opId,
            canId = event.canId,
            transport = event.transport,
            wasPolling = event.wasPolling,
            appBoardId = event.appBoardId,
            fwVersion = event.fwVersion,
            refloatBaseVersion = event.refloatBaseVersion,
        )
        val newState = ConfigRWState.ReadCollectingXml(
            ctx = ctx,
            xmlBytes = ByteArray(0),
            expectedXmlLength = null,
            nextOffset = 0,
        )
        return newState to listOf(
            ConfigRWEffect.ScheduleTimeout(
                RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT,
                CONFIG_SCHEMA_TIMEOUT_MS,
            ),
            ConfigRWEffect.SendFrame(RefloatConfigProtocol.buildGetInfo(ctx.transport)),
            ConfigRWEffect.SendFrame(buildXmlRequest(ctx.transport, expected = null, nextOffset = 0)),
        )
    }

    private fun onStartWrite(
        state: ConfigRWState,
        event: ConfigRWEvent.StartWrite,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        if (state !is ConfigRWState.Idle) return state to emptyList()
        val ctx = WriteContext(
            opId = event.opId,
            canId = event.canId,
            transport = event.transport,
            wasPolling = event.wasPolling,
            profileFields = event.profileFields,
            appBoardId = event.appBoardId,
            fwVersion = event.fwVersion,
            refloatBaseVersion = event.refloatBaseVersion,
        )
        val newState = ConfigRWState.WriteCollectingXml(
            ctx = ctx,
            xmlBytes = ByteArray(0),
            expectedXmlLength = null,
            nextOffset = 0,
        )
        return newState to listOf(
            ConfigRWEffect.ScheduleTimeout(
                RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT,
                CONFIG_SCHEMA_TIMEOUT_MS,
            ),
            ConfigRWEffect.SendFrame(RefloatConfigProtocol.buildGetInfo(ctx.transport)),
            ConfigRWEffect.SendFrame(buildXmlRequest(ctx.transport, expected = null, nextOffset = 0)),
        )
    }

    private fun onInfo(
        state: ConfigRWState,
        event: ConfigRWEvent.InfoPayloadReceived,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        val info = when (val parsed = RefloatConfigProtocol.parseGetInfoResponse(event.payload)) {
            is RefloatConfigProtocolResult.Success -> parsed.value.version
            is RefloatConfigProtocolResult.Failure -> null
        }
        if (info == null) return state to emptyList()
        return when (state) {
            is ConfigRWState.ReadCollectingXml -> state.copy(ctx = state.ctx.copy(refloatVersion = info)) to emptyList()
            is ConfigRWState.ReadAwaitingConfig -> state.copy(ctx = state.ctx.copy(refloatVersion = info)) to emptyList()
            is ConfigRWState.WriteCollectingXml -> state.copy(ctx = state.ctx.copy(refloatVersion = info)) to emptyList()
            is ConfigRWState.WriteAwaitingConfig -> state.copy(ctx = state.ctx.copy(refloatVersion = info)) to emptyList()
            is ConfigRWState.WriteAwaitingSetAck -> state.copy(ctx = state.ctx.copy(refloatVersion = info)) to emptyList()
            is ConfigRWState.WriteVerifying -> state.copy(ctx = state.ctx.copy(refloatVersion = info)) to emptyList()
            ConfigRWState.Idle -> state to emptyList()
        }
    }

    private fun onXml(
        state: ConfigRWState,
        event: ConfigRWEvent.XmlPayloadReceived,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> = when (state) {
        is ConfigRWState.ReadCollectingXml -> {
            when (val parsed = RefloatConfigProtocol.parseCustomConfigXmlResponse(event.payload)) {
                is RefloatConfigProtocolResult.Failure -> readFailure(
                    state.ctx,
                    RefloatConfigErrorCode.UNEXPECTED_CONFIG_RESPONSE,
                    parsed.message,
                    rawConfig = null,
                )
                is RefloatConfigProtocolResult.Success -> {
                    val chunk = parsed.value
                    val merged = ByteArray(state.xmlBytes.size + chunk.chunk.size)
                    state.xmlBytes.copyInto(merged)
                    chunk.chunk.copyInto(merged, state.xmlBytes.size)
                    val nextOffset = chunk.offset + chunk.chunk.size
                    if (nextOffset >= chunk.totalLength) {
                        ConfigRWState.ReadAwaitingConfig(state.ctx, merged) to listOf(
                            ConfigRWEffect.CancelTimeout,
                            ConfigRWEffect.ScheduleTimeout(
                                RefloatConfigErrorCode.CONFIG_READ_TIMEOUT,
                                CONFIG_READ_TIMEOUT_MS,
                            ),
                            ConfigRWEffect.SendFrame(buildConfigBytesRequest(state.ctx.transport)),
                        )
                    } else {
                        ConfigRWState.ReadCollectingXml(
                            ctx = state.ctx,
                            xmlBytes = merged,
                            expectedXmlLength = chunk.totalLength,
                            nextOffset = nextOffset,
                        ) to listOf(
                            ConfigRWEffect.CancelTimeout,
                            ConfigRWEffect.ScheduleTimeout(
                                RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT,
                                CONFIG_SCHEMA_TIMEOUT_MS,
                            ),
                            ConfigRWEffect.SendFrame(
                                buildXmlRequest(state.ctx.transport, chunk.totalLength, nextOffset),
                            ),
                        )
                    }
                }
            }
        }

        is ConfigRWState.WriteCollectingXml -> {
            when (val parsed = RefloatConfigProtocol.parseCustomConfigXmlResponse(event.payload)) {
                is RefloatConfigProtocolResult.Failure -> writeFailure(
                    state.ctx,
                    RefloatConfigErrorCode.UNEXPECTED_CONFIG_RESPONSE,
                    parsed.message,
                    phase = ConfigWritePhaseTag.READING_SCHEMA,
                    rawConfig = null,
                )
                is RefloatConfigProtocolResult.Success -> {
                    val chunk = parsed.value
                    val merged = ByteArray(state.xmlBytes.size + chunk.chunk.size)
                    state.xmlBytes.copyInto(merged)
                    chunk.chunk.copyInto(merged, state.xmlBytes.size)
                    val nextOffset = chunk.offset + chunk.chunk.size
                    if (nextOffset >= chunk.totalLength) {
                        ConfigRWState.WriteAwaitingConfig(state.ctx, merged) to listOf(
                            ConfigRWEffect.CancelTimeout,
                            ConfigRWEffect.ScheduleTimeout(
                                RefloatConfigErrorCode.CONFIG_READ_TIMEOUT,
                                CONFIG_READ_TIMEOUT_MS,
                            ),
                            ConfigRWEffect.SendFrame(buildConfigBytesRequest(state.ctx.transport)),
                        )
                    } else {
                        ConfigRWState.WriteCollectingXml(
                            ctx = state.ctx,
                            xmlBytes = merged,
                            expectedXmlLength = chunk.totalLength,
                            nextOffset = nextOffset,
                        ) to listOf(
                            ConfigRWEffect.CancelTimeout,
                            ConfigRWEffect.ScheduleTimeout(
                                RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT,
                                CONFIG_SCHEMA_TIMEOUT_MS,
                            ),
                            ConfigRWEffect.SendFrame(
                                buildXmlRequest(state.ctx.transport, chunk.totalLength, nextOffset),
                            ),
                        )
                    }
                }
            }
        }

        else -> state to emptyList()
    }

    private fun onConfigBytes(
        state: ConfigRWState,
        event: ConfigRWEvent.ConfigBytesPayloadReceived,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> = when (state) {
        is ConfigRWState.ReadAwaitingConfig -> {
            when (val parsed = RefloatConfigProtocol.parseCustomConfigResponse(event.payload)) {
                is RefloatConfigProtocolResult.Failure -> readFailure(
                    state.ctx,
                    RefloatConfigErrorCode.UNEXPECTED_CONFIG_RESPONSE,
                    parsed.message,
                    rawConfig = null,
                )
                is RefloatConfigProtocolResult.Success -> decodeAndCompleteRead(
                    state.ctx,
                    state.xmlBytes,
                    parsed.value,
                    event.capturedAtMs,
                )
            }
        }

        is ConfigRWState.WriteAwaitingConfig -> {
            when (val parsed = RefloatConfigProtocol.parseCustomConfigResponse(event.payload)) {
                is RefloatConfigProtocolResult.Failure -> writeFailure(
                    state.ctx,
                    RefloatConfigErrorCode.UNEXPECTED_CONFIG_RESPONSE,
                    parsed.message,
                    phase = ConfigWritePhaseTag.READING_CONFIG,
                    rawConfig = null,
                )
                is RefloatConfigProtocolResult.Success -> encodeAndSendWrite(
                    state.ctx,
                    state.xmlBytes,
                    parsed.value,
                )
            }
        }

        is ConfigRWState.WriteVerifying -> {
            when (val parsed = RefloatConfigProtocol.parseCustomConfigResponse(event.payload)) {
                is RefloatConfigProtocolResult.Failure -> writeFailure(
                    state.ctx,
                    RefloatConfigErrorCode.UNEXPECTED_CONFIG_RESPONSE,
                    parsed.message,
                    phase = ConfigWritePhaseTag.VERIFYING,
                    rawConfig = state.originalConfig,
                )
                is RefloatConfigProtocolResult.Success -> verifyAndCompleteWrite(
                    state,
                    parsed.value,
                    event.capturedAtMs,
                )
            }
        }

        else -> state to emptyList()
    }

    private fun onSetAck(
        state: ConfigRWState,
        event: ConfigRWEvent.SetConfigResponseReceived,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        if (state !is ConfigRWState.WriteAwaitingSetAck) return state to emptyList()
        return when (val parsed = RefloatConfigProtocol.parseSetCustomConfigResponse(event.payload)) {
            is RefloatConfigProtocolResult.Failure -> writeFailure(
                state.ctx,
                RefloatConfigErrorCode.CONFIG_WRITE_FAILED,
                parsed.message,
                phase = ConfigWritePhaseTag.SENDING_WRITE,
                rawConfig = state.originalConfig,
            )
            is RefloatConfigProtocolResult.Success -> ConfigRWState.WriteVerifying(
                ctx = state.ctx,
                schema = state.schema,
                originalConfig = state.originalConfig,
                patchedConfig = state.patchedConfig,
            ) to listOf(
                ConfigRWEffect.CancelTimeout,
                ConfigRWEffect.ScheduleTimeout(
                    RefloatConfigErrorCode.CONFIG_READ_TIMEOUT,
                    CONFIG_READ_TIMEOUT_MS,
                ),
                ConfigRWEffect.SendFrame(buildConfigBytesRequest(state.ctx.transport)),
            )
        }
    }

    private fun onTimeout(
        state: ConfigRWState,
        event: ConfigRWEvent.Timeout,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        val message = "Timed out reading Refloat config"
        return when (state) {
            is ConfigRWState.ReadCollectingXml -> readFailure(state.ctx, event.code, message, rawConfig = null)
            is ConfigRWState.ReadAwaitingConfig -> readFailure(state.ctx, event.code, message, rawConfig = null)
            is ConfigRWState.WriteCollectingXml -> writeFailure(
                state.ctx, event.code, message,
                phase = ConfigWritePhaseTag.READING_SCHEMA, rawConfig = null,
            )
            is ConfigRWState.WriteAwaitingConfig -> writeFailure(
                state.ctx, event.code, message,
                phase = ConfigWritePhaseTag.READING_CONFIG, rawConfig = null,
            )
            is ConfigRWState.WriteAwaitingSetAck -> writeFailure(
                state.ctx, event.code, message,
                phase = ConfigWritePhaseTag.SENDING_WRITE, rawConfig = state.originalConfig,
            )
            is ConfigRWState.WriteVerifying -> writeFailure(
                state.ctx, event.code, message,
                phase = ConfigWritePhaseTag.VERIFYING, rawConfig = state.originalConfig,
            )
            ConfigRWState.Idle -> state to emptyList()
        }
    }

    private fun onGattFailed(
        state: ConfigRWState,
        event: ConfigRWEvent.GattWriteFailed,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> = when (state) {
        is ConfigRWState.ReadCollectingXml,
        is ConfigRWState.ReadAwaitingConfig,
        -> readFailure(
            readCtxOf(state)!!,
            RefloatConfigErrorCode.GATT_NOT_WRITABLE,
            event.message,
            rawConfig = null,
        )
        is ConfigRWState.WriteCollectingXml -> writeFailure(
            state.ctx, RefloatConfigErrorCode.GATT_NOT_WRITABLE, event.message,
            phase = ConfigWritePhaseTag.READING_SCHEMA, rawConfig = null,
        )
        is ConfigRWState.WriteAwaitingConfig -> writeFailure(
            state.ctx, RefloatConfigErrorCode.GATT_NOT_WRITABLE, event.message,
            phase = ConfigWritePhaseTag.READING_CONFIG, rawConfig = null,
        )
        is ConfigRWState.WriteAwaitingSetAck -> writeFailure(
            state.ctx, RefloatConfigErrorCode.GATT_NOT_WRITABLE, event.message,
            phase = ConfigWritePhaseTag.SENDING_WRITE, rawConfig = state.originalConfig,
        )
        is ConfigRWState.WriteVerifying -> writeFailure(
            state.ctx, RefloatConfigErrorCode.GATT_NOT_WRITABLE, event.message,
            phase = ConfigWritePhaseTag.VERIFYING, rawConfig = state.originalConfig,
        )
        ConfigRWState.Idle -> state to emptyList()
    }

    private fun onSessionTerminated(
        state: ConfigRWState,
        event: ConfigRWEvent.SessionTerminated,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        val code = RefloatConfigErrorCode.BOARD_NOT_CONNECTED
        return when (state) {
            is ConfigRWState.ReadCollectingXml,
            is ConfigRWState.ReadAwaitingConfig,
            -> readTerminated(readCtxOf(state)!!, code, event.reason)
            is ConfigRWState.WriteCollectingXml -> writeTerminated(
                state.ctx, code, event.reason,
                phase = ConfigWritePhaseTag.READING_SCHEMA, rawConfig = null,
            )
            is ConfigRWState.WriteAwaitingConfig -> writeTerminated(
                state.ctx, code, event.reason,
                phase = ConfigWritePhaseTag.READING_CONFIG, rawConfig = null,
            )
            is ConfigRWState.WriteAwaitingSetAck -> writeTerminated(
                state.ctx, code, event.reason,
                phase = ConfigWritePhaseTag.SENDING_WRITE, rawConfig = state.originalConfig,
            )
            is ConfigRWState.WriteVerifying -> writeTerminated(
                state.ctx, code, event.reason,
                phase = ConfigWritePhaseTag.VERIFYING, rawConfig = state.originalConfig,
            )
            ConfigRWState.Idle -> state to emptyList()
        }
    }

    /**
     * Decode the whole schema into the session's Board Config Values, retaining the bytes, package
     * signature, and schema as the write base. Best-effort: any failure yields null so a decode hiccup
     * never breaks the read/write completion the rider actually asked for.
     */
    private fun decodeBoardConfig(
        schema: RefloatConfigSchema,
        configBytes: RefloatConfigBytes,
        boardId: String?,
        refloatBaseVersion: String?,
        capturedAtMs: Long,
    ): BoardConfigValues? =
        try {
            RefloatConfigDecoder.decodeBoardConfigValues(
                schema = schema,
                configBytes = configBytes,
                boardId = boardId,
                refloatBaseVersion = refloatBaseVersion,
                capturedAt = capturedAtMs,
            )
        } catch (e: Exception) {
            null
        }

    private fun decodeAndCompleteRead(
        ctx: ReadContext,
        xmlBytes: ByteArray,
        configBytes: RefloatConfigBytes,
        capturedAtMs: Long,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        val rawConfig = configBytes.config
        return try {
            val schema = RefloatConfigSchemaParser.parse(xmlBytes)
            val snapshot = RefloatConfigDecoder.decode(
                schema = schema,
                rawConfig = rawConfig,
                boardId = ctx.appBoardId,
                canId = ctx.canId,
                capturedAt = capturedAtMs,
                fwVersion = ctx.fwVersion,
                refloatVersion = ctx.refloatVersion,
            )
            ConfigRWState.Idle to listOf(
                ConfigRWEffect.CancelTimeout,
                ConfigRWEffect.EmitReadComplete(
                    snapshot,
                    ctx.wasPolling,
                    decodeBoardConfig(schema, configBytes, ctx.appBoardId, ctx.refloatBaseVersion, capturedAtMs),
                ),
            )
        } catch (e: RefloatConfigSchemaException) {
            ConfigRWState.Idle to listOf(
                ConfigRWEffect.CancelTimeout,
                ConfigRWEffect.DumpDebugBytes(xmlBytes, rawConfig),
                ConfigRWEffect.EmitReadFailure(
                    code = RefloatConfigErrorCode.UNSUPPORTED_SCHEMA,
                    message = e.message ?: "Unsupported Refloat config schema",
                    opId = ctx.opId,
                    resumePolling = ctx.wasPolling,
                    rawConfig = rawConfig,
                ),
            )
        } catch (e: RefloatConfigDecodeException) {
            ConfigRWState.Idle to listOf(
                ConfigRWEffect.CancelTimeout,
                ConfigRWEffect.DumpDebugBytes(xmlBytes, rawConfig),
                ConfigRWEffect.EmitReadFailure(
                    code = RefloatConfigErrorCode.CONFIG_DECODE_FAILED,
                    message = e.message ?: "Failed to decode Refloat config",
                    opId = ctx.opId,
                    resumePolling = ctx.wasPolling,
                    rawConfig = rawConfig,
                ),
            )
        } catch (e: Exception) {
            ConfigRWState.Idle to listOf(
                ConfigRWEffect.CancelTimeout,
                ConfigRWEffect.DumpDebugBytes(xmlBytes, rawConfig),
                ConfigRWEffect.EmitReadFailure(
                    code = RefloatConfigErrorCode.CONFIG_DECODE_FAILED,
                    message = e.message ?: "Failed to read Refloat config",
                    opId = ctx.opId,
                    resumePolling = ctx.wasPolling,
                    rawConfig = rawConfig,
                ),
            )
        }
    }

    private fun encodeAndSendWrite(
        ctx: WriteContext,
        xmlBytes: ByteArray,
        configBytes: RefloatConfigBytes,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        val rawConfig = configBytes.config
        return try {
            val schema = RefloatConfigSchemaParser.parse(xmlBytes)
            val patched = RefloatConfigEncoder.encode(schema, rawConfig, ctx.profileFields)
            ConfigRWState.WriteAwaitingSetAck(
                ctx = ctx,
                schema = schema,
                originalConfig = rawConfig,
                patchedConfig = patched,
            ) to listOf(
                ConfigRWEffect.CancelTimeout,
                ConfigRWEffect.ScheduleTimeout(
                    RefloatConfigErrorCode.CONFIG_WRITE_TIMEOUT,
                    CONFIG_WRITE_TIMEOUT_MS,
                ),
                ConfigRWEffect.SendFrame(
                    RefloatConfigProtocol.buildSetCustomConfig(
                        ctx.transport,
                        0,
                        configBytes.packageSignature,
                        patched,
                    ),
                ),
            )
        } catch (e: RefloatConfigSchemaException) {
            writeFailure(
                ctx, RefloatConfigErrorCode.UNSUPPORTED_SCHEMA,
                e.message ?: "Unsupported schema",
                phase = ConfigWritePhaseTag.READING_CONFIG, rawConfig = rawConfig,
            )
        } catch (e: RefloatConfigEncodeException) {
            writeFailure(
                ctx, RefloatConfigErrorCode.CONFIG_ENCODE_FAILED,
                e.message ?: "Encode failed",
                phase = ConfigWritePhaseTag.READING_CONFIG, rawConfig = rawConfig,
            )
        } catch (e: Exception) {
            writeFailure(
                ctx, RefloatConfigErrorCode.CONFIG_WRITE_FAILED,
                e.message ?: "Write failed",
                phase = ConfigWritePhaseTag.READING_CONFIG, rawConfig = rawConfig,
            )
        }
    }

    private fun verifyAndCompleteWrite(
        state: ConfigRWState.WriteVerifying,
        configFromBoard: RefloatConfigBytes,
        capturedAtMs: Long,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        val rawConfigFromBoard = configFromBoard.config
        when (val verification = RefloatConfigWriteVerifier.verifyExactBytes(
            state.patchedConfig, rawConfigFromBoard,
        )) {
            is RefloatConfigWriteVerification.Failure -> return writeFailure(
                state.ctx,
                RefloatConfigErrorCode.CONFIG_VERIFY_FAILED,
                verification.message,
                phase = ConfigWritePhaseTag.VERIFYING,
                rawConfig = state.originalConfig,
            )
            is RefloatConfigWriteVerification.Success -> Unit
        }
        return try {
            val snapshot = RefloatConfigDecoder.decode(
                schema = state.schema,
                rawConfig = rawConfigFromBoard,
                boardId = state.ctx.appBoardId,
                canId = state.ctx.canId,
                capturedAt = capturedAtMs,
                fwVersion = state.ctx.fwVersion,
                refloatVersion = state.ctx.refloatVersion,
            )
            ConfigRWState.Idle to listOf(
                ConfigRWEffect.CancelTimeout,
                ConfigRWEffect.EmitWriteComplete(
                    snapshot,
                    state.ctx.wasPolling,
                    decodeBoardConfig(
                        state.schema,
                        configFromBoard,
                        state.ctx.appBoardId,
                        state.ctx.refloatBaseVersion,
                        capturedAtMs,
                    ),
                ),
            )
        } catch (e: RefloatConfigDecodeException) {
            writeFailure(
                state.ctx,
                RefloatConfigErrorCode.CONFIG_VERIFY_FAILED,
                e.message ?: "Verification failed",
                phase = ConfigWritePhaseTag.VERIFYING,
                rawConfig = state.originalConfig,
            )
        } catch (e: Exception) {
            writeFailure(
                state.ctx,
                RefloatConfigErrorCode.CONFIG_VERIFY_FAILED,
                e.message ?: "Verification failed",
                phase = ConfigWritePhaseTag.VERIFYING,
                rawConfig = state.originalConfig,
            )
        }
    }

    private fun readFailure(
        ctx: ReadContext,
        code: RefloatConfigErrorCode,
        message: String,
        rawConfig: ByteArray?,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> = ConfigRWState.Idle to listOf(
        ConfigRWEffect.CancelTimeout,
        ConfigRWEffect.EmitReadFailure(
            code = code,
            message = message,
            opId = ctx.opId,
            resumePolling = ctx.wasPolling,
            rawConfig = rawConfig,
        ),
    )

    private fun readTerminated(
        ctx: ReadContext,
        code: RefloatConfigErrorCode,
        message: String,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> = ConfigRWState.Idle to listOf(
        ConfigRWEffect.CancelTimeout,
        ConfigRWEffect.EmitReadFailure(
            code = code,
            message = message,
            opId = ctx.opId,
            resumePolling = false,
            rawConfig = null,
        ),
    )

    private fun writeFailure(
        ctx: WriteContext,
        code: RefloatConfigErrorCode,
        message: String,
        phase: ConfigWritePhaseTag,
        rawConfig: ByteArray?,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> = ConfigRWState.Idle to listOf(
        ConfigRWEffect.CancelTimeout,
        ConfigRWEffect.EmitWriteFailure(
            code = code,
            message = message,
            opId = ctx.opId,
            resumePolling = ctx.wasPolling,
            phase = phase,
            rawConfig = rawConfig,
        ),
    )

    private fun writeTerminated(
        ctx: WriteContext,
        code: RefloatConfigErrorCode,
        message: String,
        phase: ConfigWritePhaseTag,
        rawConfig: ByteArray?,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> = ConfigRWState.Idle to listOf(
        ConfigRWEffect.CancelTimeout,
        ConfigRWEffect.EmitWriteFailure(
            code = code,
            message = message,
            opId = ctx.opId,
            resumePolling = false,
            phase = phase,
            rawConfig = rawConfig,
        ),
    )

    private fun readCtxOf(state: ConfigRWState): ReadContext? = when (state) {
        is ConfigRWState.ReadCollectingXml -> state.ctx
        is ConfigRWState.ReadAwaitingConfig -> state.ctx
        else -> null
    }

    private fun buildXmlRequest(transport: BoardTransport, expected: Int?, nextOffset: Int): ByteArray {
        val length = (
            if (expected == null) CONFIG_CHUNK_LENGTH
            else (expected - nextOffset).coerceAtMost(CONFIG_CHUNK_LENGTH)
            ).coerceAtLeast(0)
        return RefloatConfigProtocol.buildGetCustomConfigXml(
            transport = transport,
            confInd = 0,
            length = length,
            offset = nextOffset,
        )
    }

    private fun buildConfigBytesRequest(transport: BoardTransport): ByteArray =
        RefloatConfigProtocol.buildGetCustomConfig(transport = transport, confInd = 0)
}
