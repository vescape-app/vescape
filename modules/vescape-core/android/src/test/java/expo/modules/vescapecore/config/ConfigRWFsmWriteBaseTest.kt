package expo.modules.vescapecore.config

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Trust session config on write (#396): a push backed by the session's fresh Board Config Values
 * patches the retained bytes and goes straight to `COMM_SET_CUSTOM_CONFIG`. Without a write base —
 * provisional values, or none at all — the write still reads the board first.
 *
 * @parity /modules/vescape-core/ios/config/ConfigRWControllerWriteBaseTests.swift
 */
class ConfigRWFsmWriteBaseTest {
    private val schema = RefloatConfigSchema(
        hash = "test",
        fields = listOf(
            RefloatConfigSchemaField("tuned", RefloatConfigValueType.FLOAT32, "tuned", null, null, null, 0),
            RefloatConfigSchemaField("untouched", RefloatConfigValueType.FLOAT32, "untouched", null, null, null, 4),
        ),
    )
    private val rawConfig = byteArrayOf(0x3F, 0x80.toByte(), 0x00, 0x00, 0x42, 0x28, 0x00, 0x00)

    @Test
    fun freshWriteBaseSkipsTheReadAndSendsTheWrite() {
        val (state, effects) = ConfigRWFsm.apply(ConfigRWState.Idle, startWrite(writeBase()))

        assertTrue(state is ConfigRWState.WriteAwaitingSetAck)
        assertEquals(
            "Refloat version comes from the session, not a get-info round trip",
            "Refloat 3.0.7",
            (state as ConfigRWState.WriteAwaitingSetAck).ctx.refloatVersion,
        )
        assertFalse(effects.sends(COMM_GET_CUSTOM_CONFIG_XML))
        assertFalse(effects.sends(COMM_GET_CUSTOM_CONFIG))
        assertTrue(effects.sends(COMM_SET_CUSTOM_CONFIG))
    }

    @Test
    fun writeKeepsBytesOutsideTheProfileFields() {
        val (_, effects) = ConfigRWFsm.apply(ConfigRWState.Idle, startWrite(writeBase()))

        val frame = effects.frame(COMM_SET_CUSTOM_CONFIG)!!
        val payload = frame.copyOfRange(frame.size - rawConfig.size, frame.size)
        assertArrayEquals(
            "signature must come from the retained bytes",
            byteArrayOf(0xDE.toByte(), 0xAD.toByte(), 0xBE.toByte(), 0xEF.toByte()),
            frame.copyOfRange(2, 6),
        )
        assertArrayEquals(
            "untouched field must survive",
            rawConfig.copyOfRange(4, 8),
            payload.copyOfRange(4, 8),
        )
        assertFalse(
            "tuned field must change",
            rawConfig.copyOfRange(0, 4).contentEquals(payload.copyOfRange(0, 4)),
        )
    }

    @Test
    fun noWriteBaseReadsTheBoardFirst() {
        val (state, effects) = ConfigRWFsm.apply(ConfigRWState.Idle, startWrite(null))

        assertTrue(state is ConfigRWState.WriteCollectingXml)
        assertTrue(effects.sends(COMM_GET_CUSTOM_CONFIG_XML))
        assertFalse(effects.sends(COMM_SET_CUSTOM_CONFIG))
    }

    @Test
    fun linkDropDemotesFreshValuesSoTheyCannotBackAWrite() {
        val fresh = BoardConfigValues(
            boardId = "board-1",
            refloatBaseVersion = "3.0.7",
            capturedAtMs = 1,
            freshness = BoardConfigFreshness.FRESH,
            values = mapOf("tuned" to 1.0),
            writeBase = writeBase(),
        )

        val demoted = fresh.demotedToProvisional()

        assertEquals(BoardConfigFreshness.PROVISIONAL, demoted.freshness)
        assertEquals(null, demoted.writeBase)
        assertEquals(fresh.values, demoted.values)
    }

    @Test
    fun provisionalValuesCarryNoWriteBase() {
        val provisional = BoardConfigValues.provisional(
            boardId = "board-1",
            refloatBaseVersion = "3.0.7",
            capturedAtMs = 0,
            valuesJson = """{"tuned":1.0}""",
        )

        assertEquals(BoardConfigFreshness.PROVISIONAL, provisional.freshness)
        assertEquals(null, provisional.writeBase)
    }

    private fun writeBase() = BoardConfigWriteBase(schema, rawConfig, 0xDEADBEEF)

    private fun startWrite(writeBase: BoardConfigWriteBase?) = ConfigRWEvent.StartWrite(
        opId = "op-1",
        canId = null,
        transport = BoardTransport.Direct,
        wasPolling = false,
        profileFields = mapOf("tuned" to 7.0),
        appBoardId = "board-1",
        fwVersion = "FW 6.05",
        refloatBaseVersion = "3.0.7",
        refloatVersion = "Refloat 3.0.7",
        writeBase = writeBase,
    )

    private fun List<ConfigRWEffect>.frame(command: Int): ByteArray? =
        filterIsInstance<ConfigRWEffect.SendFrame>()
            .map { it.payload }
            .firstOrNull { it.isNotEmpty() && it[0].toInt() and 0xFF == command }

    private fun List<ConfigRWEffect>.sends(command: Int) = frame(command) != null
}
