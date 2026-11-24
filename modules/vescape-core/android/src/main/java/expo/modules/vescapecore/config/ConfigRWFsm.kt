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
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        val (next, effects) = reduce(state, event)
        val uncertain = state.setConfigSent() &&
            event !is ConfigRWEvent.SetConfigBlocked &&
            effects.any { it is ConfigRWEffect.EmitWriteFailure }
        if (!uncertain) return next to effects
        val annotated = effects.map { effect ->
            if (effect is ConfigRWEffect.EmitWriteFailure) effect.copy(demotedWriteBase = true) else effect
        }
        return next to (listOf(ConfigRWEffect.DemoteWriteBase) + annotated)
    }

    private fun ConfigRWState.setConfigSent() =
        this is ConfigRWState.WriteAwaitingSetAck || this is ConfigRWState.WriteVerifying

    private fun reduce(
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
        is ConfigRWEvent.SetConfigBlocked -> onSetConfigBlocked(state, event)
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
            intent = event.intent,
            appBoardId = event.appBoardId,
            fwVersion = event.fwVersion,
            refloatBaseVersion = event.refloatBaseVersion,
            refloatVersion = event.refloatVersion,
        )
        val writeBase = event.writeBase
        if (writeBase != null) {
            return sendWrite(
                ctx = ctx,
                schema = writeBase.schema,
                configBytes = RefloatConfigBytes(0, writeBase.packageSignature, writeBase.rawConfig),
                capturedAtMs = event.startedAtMs,
                fromFreshRead = false,
                failPhase = ConfigWritePhaseTag.SENDING_WRITE,
            )
        }
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
        val transport = transportOf(state) ?: return state to emptyList()
        if (!RefloatConfigProtocol.matchesTransport(event.payload, transport)) return state to emptyList()
        val info = when (val parsed = RefloatConfigProtocol.parseGetInfoResponse(event.payload, transport)) {
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
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
      return when (state) {
        is ConfigRWState.ReadCollectingXml -> {
            if (!RefloatConfigProtocol.matchesTransport(event.payload, state.ctx.transport)) return state to emptyList()
            when (val parsed = RefloatConfigProtocol.parseCustomConfigXmlResponse(event.payload, transport = state.ctx.transport)) {
                is RefloatConfigProtocolResult.Failure -> readFailure(
                    state.ctx,
                    RefloatConfigErrorCode.UNEXPECTED_CONFIG_RESPONSE,
                    parsed.message,
                    rawConfig = null,
                )
                is RefloatConfigProtocolResult.Success -> {
                    val chunk = parsed.value
                    if (chunk.offset != state.nextOffset) return state to emptyList()
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
            if (!RefloatConfigProtocol.matchesTransport(event.payload, state.ctx.transport)) return state to emptyList()
            when (val parsed = RefloatConfigProtocol.parseCustomConfigXmlResponse(event.payload, transport = state.ctx.transport)) {
                is RefloatConfigProtocolResult.Failure -> writeFailure(
                    state.ctx,
                    RefloatConfigErrorCode.UNEXPECTED_CONFIG_RESPONSE,
                    parsed.message,
                    phase = ConfigWritePhaseTag.READING_SCHEMA,
                    rawConfig = null,
                )
                is RefloatConfigProtocolResult.Success -> {
                    val chunk = parsed.value
                    if (chunk.offset != state.nextOffset) return state to emptyList()
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

    }

    private fun onConfigBytes(
        state: ConfigRWState,
        event: ConfigRWEvent.ConfigBytesPayloadReceived,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> = when (state) {
        is ConfigRWState.ReadAwaitingConfig -> {
            if (!RefloatConfigProtocol.matchesTransport(event.payload, state.ctx.transport)) {
                state to emptyList()
            } else {
                when (val parsed = RefloatConfigProtocol.parseCustomConfigResponse(event.payload, transport = state.ctx.transport)) {
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
        }

        is ConfigRWState.WriteAwaitingConfig -> {
            if (!RefloatConfigProtocol.matchesTransport(event.payload, state.ctx.transport)) {
                state to emptyList()
            } else {
                when (val parsed = RefloatConfigProtocol.parseCustomConfigResponse(event.payload, transport = state.ctx.transport)) {
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
                        event.capturedAtMs,
                    )
                }
            }
        }

        is ConfigRWState.WriteVerifying -> {
            if (!RefloatConfigProtocol.matchesTransport(event.payload, state.ctx.transport)) {
                state to emptyList()
            } else {
                when (val parsed = RefloatConfigProtocol.parseCustomConfigResponse(event.payload, transport = state.ctx.transport)) {
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
        }

        else -> state to emptyList()
    }

    private fun onSetAck(
        state: ConfigRWState,
        event: ConfigRWEvent.SetConfigResponseReceived,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        if (state !is ConfigRWState.WriteAwaitingSetAck) return state to emptyList()
        if (!RefloatConfigProtocol.matchesTransport(event.payload, state.ctx.transport)) return state to emptyList()
        return when (val parsed = RefloatConfigProtocol.parseSetCustomConfigResponse(event.payload, transport = state.ctx.transport)) {
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
            is ConfigRWState.ReadCollectingXml -> if (!state.retried) {
                state.copy(retried = true) to listOf(
                    ConfigRWEffect.ScheduleTimeout(RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT, CONFIG_SCHEMA_TIMEOUT_MS),
                    ConfigRWEffect.SendFrame(buildXmlRequest(state.ctx.transport, state.expectedXmlLength, state.nextOffset)),
                )
            } else readFailure(state.ctx, event.code, "$message at XML offset ${state.nextOffset}", rawConfig = null)
            is ConfigRWState.ReadAwaitingConfig -> readFailure(state.ctx, event.code, message, rawConfig = null)
            is ConfigRWState.WriteCollectingXml -> if (!state.retried) {
                state.copy(retried = true) to listOf(
                    ConfigRWEffect.ScheduleTimeout(RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT, CONFIG_SCHEMA_TIMEOUT_MS),
                    ConfigRWEffect.SendFrame(buildXmlRequest(state.ctx.transport, state.expectedXmlLength, state.nextOffset)),
                )
            } else writeFailure(
                state.ctx, event.code, "$message at XML offset ${state.nextOffset}",
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

    private fun onSetConfigBlocked(
        state: ConfigRWState,
        event: ConfigRWEvent.SetConfigBlocked,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        if (state !is ConfigRWState.WriteAwaitingSetAck) return state to emptyList()
        return writeFailure(
            state.ctx, RefloatConfigErrorCode.BOARD_NOT_IDLE, event.message,
            phase = ConfigWritePhaseTag.SENDING_WRITE, rawConfig = state.originalConfig,
        )
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
        capturedAtMs: Long,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        val rawConfig = configBytes.config
        return try {
            val schema = RefloatConfigSchemaParser.parse(xmlBytes)
            sendWrite(
                ctx = ctx,
                schema = schema,
                configBytes = configBytes,
                capturedAtMs = capturedAtMs,
                fromFreshRead = true,
                failPhase = ConfigWritePhaseTag.READING_CONFIG,
            )
        } catch (e: RefloatConfigSchemaException) {
            writeFailure(
                ctx, RefloatConfigErrorCode.UNSUPPORTED_SCHEMA,
                e.message ?: "Unsupported schema",
                phase = ConfigWritePhaseTag.READING_CONFIG, rawConfig = rawConfig,
            )
        }
    }

    private fun sendWrite(
        ctx: WriteContext,
        schema: RefloatConfigSchema,
        configBytes: RefloatConfigBytes,
        capturedAtMs: Long,
        fromFreshRead: Boolean,
        failPhase: ConfigWritePhaseTag,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        val rawConfig = configBytes.config
        return try {
            val changes = resolveChanges(ctx.intent, schema)
            val encoded = RefloatConfigEncoder.encodeChangeset(schema, rawConfig, changes)
            if (encoded.changedFieldIds.isEmpty()) {
                val snapshot = RefloatConfigDecoder.decode(
                    schema = schema,
                    rawConfig = rawConfig,
                    boardId = ctx.appBoardId,
                    canId = ctx.canId,
                    capturedAt = capturedAtMs,
                    fwVersion = ctx.fwVersion,
                    refloatVersion = ctx.refloatVersion,
                )
                val freshValues = if (fromFreshRead) {
                    decodeBoardConfig(schema, configBytes, ctx.appBoardId, ctx.refloatBaseVersion, capturedAtMs)
                } else null
                return ConfigRWState.Idle to listOf(
                    ConfigRWEffect.CancelTimeout,
                    ConfigRWEffect.EmitWriteComplete(
                        snapshot = snapshot,
                        resumePolling = ctx.wasPolling,
                        boardConfigValues = freshValues,
                        origin = BoardConfigOperationOrigin.FRESH_READ,
                    ),
                )
            }
            ConfigRWState.WriteAwaitingSetAck(
                ctx = ctx,
                schema = schema,
                originalConfig = rawConfig,
                patchedConfig = encoded.rawConfig,
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
                        encoded.rawConfig,
                    ),
                    requiresIdleBoard = true,
                ),
            )
        } catch (e: RefloatConfigEncodeException) {
            writeFailure(
                ctx, e.code,
                e.message ?: "Encode failed",
                phase = failPhase, rawConfig = rawConfig,
            )
        } catch (e: RefloatConfigDecodeException) {
            writeFailure(
                ctx, RefloatConfigErrorCode.CONFIG_DECODE_FAILED,
                e.message ?: "Decode failed",
                phase = failPhase, rawConfig = rawConfig,
            )
        } catch (e: Exception) {
            writeFailure(
                ctx, RefloatConfigErrorCode.CONFIG_WRITE_FAILED,
                e.message ?: "Write failed",
                phase = failPhase, rawConfig = rawConfig,
            )
        }
    }

    private fun resolveChanges(intent: ConfigWriteIntent, schema: RefloatConfigSchema): Map<String, Any?> =
        when (intent) {
            is ConfigWriteIntent.Changeset -> intent.changes
            is ConfigWriteIntent.Profile -> {
                val schemaIds = schema.fields.mapTo(HashSet()) { it.id }
                intent.fields.filterKeys { it in schemaIds }
            }
        }

    private fun verifyAndCompleteWrite(
        state: ConfigRWState.WriteVerifying,
        configFromBoard: RefloatConfigBytes,
        capturedAtMs: Long,
    ): Pair<ConfigRWState, List<ConfigRWEffect>> {
        val rawConfigFromBoard = configFromBoard.config
        when (val verification = RefloatConfigWriteVerifier.verify(
            state.schema, state.patchedConfig, rawConfigFromBoard,
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

    internal fun transportOf(state: ConfigRWState): BoardTransport? = when (state) {
        is ConfigRWState.ReadCollectingXml -> state.ctx.transport
        is ConfigRWState.ReadAwaitingConfig -> state.ctx.transport
        is ConfigRWState.WriteCollectingXml -> state.ctx.transport
        is ConfigRWState.WriteAwaitingConfig -> state.ctx.transport
        is ConfigRWState.WriteAwaitingSetAck -> state.ctx.transport
        is ConfigRWState.WriteVerifying -> state.ctx.transport
        ConfigRWState.Idle -> null
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
