package expo.modules.vescapecore.config
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.REFLOAT_GET_INFO
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC
import expo.modules.vescapecore.connection.BoardTransport
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ConfigRWFsmTest {
    private val canId: Int? = 7
    private val opId = "op-1"

    private val schemaXml = """
        <CustomConfiguration>
          <params>
            <param name="kp" type="float" min="0" max="100" />
          </params>
        </CustomConfiguration>
    """.trimIndent().encodeToByteArray()

    private val configBytes: ByteArray = ByteBuffer.allocate(4)
        .order(ByteOrder.BIG_ENDIAN)
        .putFloat(12.5f)
        .array()

    private val profileFields = mapOf<String, Any>("kp" to 33.0)

    @Test
    fun `read happy path emits snapshot via two xml chunks then config`() {
        val (afterStart, startEffects) = ConfigRWFsm.apply(
            ConfigRWState.Idle,
            startRead(canId, wasPolling = true),
        )
        assertTrue(afterStart is ConfigRWState.ReadCollectingXml)
        assertTimeoutScheduled(startEffects, RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT)
        assertSendFrame(startEffects)

        val (afterInfo, infoEffects) = ConfigRWFsm.apply(
            afterStart,
            ConfigRWEvent.InfoPayloadReceived(buildInfoV1Payload(12)),
        )
        assertTrue(infoEffects.isEmpty())

        val firstHalf = schemaXml.copyOfRange(0, schemaXml.size / 2)
        val secondHalf = schemaXml.copyOfRange(schemaXml.size / 2, schemaXml.size)

        val (afterFirst, firstEffects) = ConfigRWFsm.apply(
            afterInfo,
            ConfigRWEvent.XmlPayloadReceived(
                buildXmlChunkPayload(schemaXml.size, 0, firstHalf),
            ),
        )
        assertTrue(afterFirst is ConfigRWState.ReadCollectingXml)
        assertTimeoutScheduled(firstEffects, RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT)

        val (afterSecond, secondEffects) = ConfigRWFsm.apply(
            afterFirst,
            ConfigRWEvent.XmlPayloadReceived(
                buildXmlChunkPayload(schemaXml.size, firstHalf.size, secondHalf),
            ),
        )
        assertTrue(afterSecond is ConfigRWState.ReadAwaitingConfig)
        assertTimeoutScheduled(secondEffects, RefloatConfigErrorCode.CONFIG_READ_TIMEOUT)

        val (afterConfig, configEffects) = ConfigRWFsm.apply(
            afterSecond,
            ConfigRWEvent.ConfigBytesPayloadReceived(
                buildConfigBytesPayload(configBytes),
                capturedAtMs = 12345L,
            ),
        )
        assertSame(ConfigRWState.Idle, afterConfig)
        val complete = configEffects.filterIsInstance<ConfigRWEffect.EmitReadComplete>().single()
        assertEquals(12345L, complete.snapshot.capturedAt)
        assertTrue(complete.resumePolling)
        assertEquals(4, complete.snapshot.rawConfigLength)
        assertEquals("Refloat 1.2", complete.snapshot.refloatVersion)
    }

    @Test
    fun `write happy path runs schema config setAck verify and emits snapshot`() {
        val (afterStart, _) = ConfigRWFsm.apply(
            ConfigRWState.Idle,
            startWrite(canId, wasPolling = false),
        )
        assertTrue(afterStart is ConfigRWState.WriteCollectingXml)

        val (afterSchema, _) = ConfigRWFsm.apply(
            afterStart,
            ConfigRWEvent.XmlPayloadReceived(
                buildXmlChunkPayload(schemaXml.size, 0, schemaXml),
            ),
        )
        assertTrue(afterSchema is ConfigRWState.WriteAwaitingConfig)

        val (afterConfig, configEffects) = ConfigRWFsm.apply(
            afterSchema,
            ConfigRWEvent.ConfigBytesPayloadReceived(
                buildConfigBytesPayload(configBytes),
                capturedAtMs = 1L,
            ),
        )
        assertTrue(afterConfig is ConfigRWState.WriteAwaitingSetAck)
        val sentFrame = configEffects.filterIsInstance<ConfigRWEffect.SendFrame>().single()
        assertTrue(
            "set custom config frame expected",
            sentFrame.payload.size >= 4 &&
                sentFrame.payload[2].toInt() and 0xff == COMM_SET_CUSTOM_CONFIG,
        )
        assertEquals(0x12, sentFrame.payload[4].toInt() and 0xff)
        assertEquals(0x34, sentFrame.payload[5].toInt() and 0xff)
        assertEquals(0x56, sentFrame.payload[6].toInt() and 0xff)
        assertEquals(0x78, sentFrame.payload[7].toInt() and 0xff)
        val patchedConfig = (afterConfig as ConfigRWState.WriteAwaitingSetAck).patchedConfig
        val patchedKp = ByteBuffer.wrap(patchedConfig).order(ByteOrder.BIG_ENDIAN).float
        assertEquals(33.0f, patchedKp, 0.001f)

        val (afterAck, ackEffects) = ConfigRWFsm.apply(
            afterConfig,
            ConfigRWEvent.SetConfigResponseReceived(buildSetAckPayload()),
        )
        assertTrue(afterAck is ConfigRWState.WriteVerifying)
        assertTimeoutScheduled(ackEffects, RefloatConfigErrorCode.CONFIG_READ_TIMEOUT)

        val (afterVerify, verifyEffects) = ConfigRWFsm.apply(
            afterAck,
            ConfigRWEvent.ConfigBytesPayloadReceived(
                buildConfigBytesPayload(patchedConfig),
                capturedAtMs = 999L,
            ),
        )
        assertSame(ConfigRWState.Idle, afterVerify)
        val complete = verifyEffects.filterIsInstance<ConfigRWEffect.EmitWriteComplete>().single()
        assertEquals(999L, complete.snapshot.capturedAt)
    }

    @Test
    fun `schema timeout in read returns failure with CONFIG_SCHEMA_TIMEOUT`() {
        val (state, _) = ConfigRWFsm.apply(ConfigRWState.Idle, startRead(canId, wasPolling = true))
        val (next, effects) = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.Timeout(RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT),
        )
        assertSame(ConfigRWState.Idle, next)
        val failure = effects.filterIsInstance<ConfigRWEffect.EmitReadFailure>().single()
        assertEquals(RefloatConfigErrorCode.CONFIG_SCHEMA_TIMEOUT, failure.code)
        assertTrue(failure.resumePolling)
    }

    @Test
    fun `read timeout while waiting for config returns failure`() {
        var state: ConfigRWState = ConfigRWState.Idle
        state = ConfigRWFsm.apply(state, startRead(canId, wasPolling = false)).first
        state = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.XmlPayloadReceived(buildXmlChunkPayload(schemaXml.size, 0, schemaXml)),
        ).first
        val (next, effects) = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.Timeout(RefloatConfigErrorCode.CONFIG_READ_TIMEOUT),
        )
        assertSame(ConfigRWState.Idle, next)
        val failure = effects.filterIsInstance<ConfigRWEffect.EmitReadFailure>().single()
        assertEquals(RefloatConfigErrorCode.CONFIG_READ_TIMEOUT, failure.code)
    }

    @Test
    fun `write timeout while awaiting set ack reports SENDING_WRITE phase`() {
        var state: ConfigRWState = ConfigRWState.Idle
        state = ConfigRWFsm.apply(state, startWrite(canId, wasPolling = true)).first
        state = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.XmlPayloadReceived(buildXmlChunkPayload(schemaXml.size, 0, schemaXml)),
        ).first
        state = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.ConfigBytesPayloadReceived(buildConfigBytesPayload(configBytes), 0L),
        ).first
        val (next, effects) = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.Timeout(RefloatConfigErrorCode.CONFIG_WRITE_TIMEOUT),
        )
        assertSame(ConfigRWState.Idle, next)
        val failure = effects.filterIsInstance<ConfigRWEffect.EmitWriteFailure>().single()
        assertEquals(RefloatConfigErrorCode.CONFIG_WRITE_TIMEOUT, failure.code)
        assertEquals(ConfigWritePhaseTag.SENDING_WRITE, failure.phase)
        assertNotNull(failure.rawConfig)
    }

    @Test
    fun `set config failure surfaces CONFIG_WRITE_FAILED`() {
        var state: ConfigRWState = ConfigRWState.Idle
        state = ConfigRWFsm.apply(state, startWrite(canId, wasPolling = false)).first
        state = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.XmlPayloadReceived(buildXmlChunkPayload(schemaXml.size, 0, schemaXml)),
        ).first
        state = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.ConfigBytesPayloadReceived(buildConfigBytesPayload(configBytes), 0L),
        ).first

        // Build a corrupt set-config response (wrong command byte = read instead of set)
        val bogus = byteArrayOf(
            COMM_GET_CUSTOM_CONFIG.toByte(),
            0,
        )
        val (next, effects) = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.SetConfigResponseReceived(bogus),
        )
        assertSame(ConfigRWState.Idle, next)
        val failure = effects.filterIsInstance<ConfigRWEffect.EmitWriteFailure>().single()
        assertEquals(RefloatConfigErrorCode.CONFIG_WRITE_FAILED, failure.code)
        assertEquals(ConfigWritePhaseTag.SENDING_WRITE, failure.phase)
    }

    @Test
    fun `payload received while idle is ignored without effects`() {
        val (next, effects) = ConfigRWFsm.apply(
            ConfigRWState.Idle,
            ConfigRWEvent.XmlPayloadReceived(buildXmlChunkPayload(schemaXml.size, 0, schemaXml)),
        )
        assertSame(ConfigRWState.Idle, next)
        assertTrue(effects.isEmpty())
    }

    @Test
    fun `unexpected confInd surfaces UNEXPECTED_CONFIG_RESPONSE`() {
        var state: ConfigRWState = ConfigRWState.Idle
        state = ConfigRWFsm.apply(state, startRead(canId, wasPolling = false)).first

        val payload = buildXmlChunkPayloadWithConfInd(
            confInd = 9,
            totalLength = schemaXml.size,
            offset = 0,
            chunk = schemaXml,
        )

        val (next, effects) = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.XmlPayloadReceived(payload),
        )
        assertSame(ConfigRWState.Idle, next)
        val failure = effects.filterIsInstance<ConfigRWEffect.EmitReadFailure>().single()
        assertEquals(RefloatConfigErrorCode.UNEXPECTED_CONFIG_RESPONSE, failure.code)
        assertNull(failure.rawConfig)
    }

    @Test
    fun `session terminated mid-read emits BOARD_NOT_CONNECTED with resumePolling false`() {
        var state: ConfigRWState = ConfigRWState.Idle
        state = ConfigRWFsm.apply(state, startRead(canId, wasPolling = true)).first
        val (next, effects) = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.SessionTerminated("disconnected"),
        )
        assertSame(ConfigRWState.Idle, next)
        val failure = effects.filterIsInstance<ConfigRWEffect.EmitReadFailure>().single()
        assertEquals(RefloatConfigErrorCode.BOARD_NOT_CONNECTED, failure.code)
        assertEquals(false, failure.resumePolling)
    }

    @Test
    fun `unsupported schema bytes trigger UNSUPPORTED_SCHEMA failure and debug dump`() {
        var state: ConfigRWState = ConfigRWState.Idle
        state = ConfigRWFsm.apply(state, startRead(canId, wasPolling = false)).first
        val brokenXml = "<not-config-xml>".encodeToByteArray()
        state = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.XmlPayloadReceived(buildXmlChunkPayload(brokenXml.size, 0, brokenXml)),
        ).first
        val (next, effects) = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.ConfigBytesPayloadReceived(buildConfigBytesPayload(configBytes), 0L),
        )
        assertSame(ConfigRWState.Idle, next)
        assertTrue(effects.any { it is ConfigRWEffect.DumpDebugBytes })
        val failure = effects.filterIsInstance<ConfigRWEffect.EmitReadFailure>().single()
        assertEquals(RefloatConfigErrorCode.UNSUPPORTED_SCHEMA, failure.code)
    }

    @Test
    fun `set ack response received while idle is ignored`() {
        val (next, effects) = ConfigRWFsm.apply(
            ConfigRWState.Idle,
            ConfigRWEvent.SetConfigResponseReceived(buildSetAckPayload()),
        )
        assertSame(ConfigRWState.Idle, next)
        assertTrue(effects.isEmpty())
    }

    @Test
    fun `start read while non-idle is ignored`() {
        val (state, _) = ConfigRWFsm.apply(ConfigRWState.Idle, startRead(canId, wasPolling = false))
        val (next, effects) = ConfigRWFsm.apply(state, startRead(canId, wasPolling = false))
        assertSame(state, next)
        assertTrue(effects.isEmpty())
    }

    @Test
    fun `verifier mismatch surfaces CONFIG_VERIFY_FAILED`() {
        var state: ConfigRWState = ConfigRWState.Idle
        state = ConfigRWFsm.apply(state, startWrite(canId, wasPolling = false)).first
        state = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.XmlPayloadReceived(buildXmlChunkPayload(schemaXml.size, 0, schemaXml)),
        ).first
        state = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.ConfigBytesPayloadReceived(buildConfigBytesPayload(configBytes), 0L),
        ).first
        state = ConfigRWFsm.apply(state, ConfigRWEvent.SetConfigResponseReceived(buildSetAckPayload())).first

        val tampered = ByteBuffer.allocate(4)
            .order(ByteOrder.BIG_ENDIAN)
            .putFloat(99.0f)
            .array()
        val (next, effects) = ConfigRWFsm.apply(
            state,
            ConfigRWEvent.ConfigBytesPayloadReceived(buildConfigBytesPayload(tampered), 0L),
        )
        assertSame(ConfigRWState.Idle, next)
        val failure = effects.filterIsInstance<ConfigRWEffect.EmitWriteFailure>().single()
        assertEquals(RefloatConfigErrorCode.CONFIG_VERIFY_FAILED, failure.code)
        assertEquals(ConfigWritePhaseTag.VERIFYING, failure.phase)
    }

    private fun startRead(canId: Int?, wasPolling: Boolean): ConfigRWEvent.StartRead =
        ConfigRWEvent.StartRead(
            opId = opId,
            canId = canId,
            transport = BoardTransport.Can(canId ?: 0),
            wasPolling = wasPolling,
            appBoardId = "board-1",
            fwVersion = "fw-test",
            refloatBaseVersion = "3.0",
        )

    private fun startWrite(canId: Int?, wasPolling: Boolean): ConfigRWEvent.StartWrite =
        ConfigRWEvent.StartWrite(
            opId = opId,
            canId = canId,
            transport = BoardTransport.Can(canId ?: 0),
            wasPolling = wasPolling,
            profileFields = profileFields,
            appBoardId = "board-1",
            fwVersion = "fw-test",
            refloatBaseVersion = "3.0",
            refloatVersion = null,
            writeBase = null,
        )

    private fun assertTimeoutScheduled(
        effects: List<ConfigRWEffect>,
        expected: RefloatConfigErrorCode,
    ) {
        val timeout = effects.filterIsInstance<ConfigRWEffect.ScheduleTimeout>().firstOrNull()
            ?: fail("Expected ScheduleTimeout effect for $expected").let { return }
        assertEquals(expected, timeout.code)
    }

    private fun assertSendFrame(effects: List<ConfigRWEffect>) {
        assertTrue(
            "Expected SendFrame effect",
            effects.any { it is ConfigRWEffect.SendFrame },
        )
    }

    private fun buildXmlChunkPayload(totalLength: Int, offset: Int, chunk: ByteArray): ByteArray =
        buildXmlChunkPayloadWithConfInd(0, totalLength, offset, chunk)

    private fun buildXmlChunkPayloadWithConfInd(
        confInd: Int,
        totalLength: Int,
        offset: Int,
        chunk: ByteArray,
    ): ByteArray {
        val buf = ByteBuffer.allocate(12 + chunk.size)
            .order(ByteOrder.BIG_ENDIAN)
            .put(COMM_FORWARD_CAN.toByte())
            .put((canId ?: 0).toByte())
            .put(COMM_GET_CUSTOM_CONFIG_XML.toByte())
            .put(confInd.toByte())
            .putInt(totalLength)
            .putInt(offset)
            .put(chunk)
        return buf.array()
    }

    private fun buildConfigBytesPayload(config: ByteArray): ByteArray {
        val buf = ByteBuffer.allocate(8 + config.size)
            .order(ByteOrder.BIG_ENDIAN)
            .put(COMM_FORWARD_CAN.toByte())
            .put((canId ?: 0).toByte())
            .put(COMM_GET_CUSTOM_CONFIG.toByte())
            .put(0.toByte())
            .putInt(0x12345678) // package signature
            .put(config)
        return buf.array()
    }

    private fun buildSetAckPayload(): ByteArray = byteArrayOf(
        COMM_FORWARD_CAN.toByte(),
        (canId ?: 0).toByte(),
        COMM_SET_CUSTOM_CONFIG.toByte(),
    )

    private fun buildInfoV1Payload(versionCode: Int): ByteArray = byteArrayOf(
        COMM_FORWARD_CAN.toByte(),
        (canId ?: 0).toByte(),
        COMM_CUSTOM_APP_DATA.toByte(),
        REFLOAT_MAGIC.toByte(),
        REFLOAT_GET_INFO.toByte(),
        versionCode.toByte(),
        1,
        0,
    )
}
