package expo.modules.vescapecore.protocol

import expo.modules.vescapecore.connection.BoardTransport

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.pow

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift
 */
internal const val COMM_FW_VERSION = 0
internal const val COMM_FORWARD_CAN = 34
internal const val COMM_CUSTOM_APP_DATA = 36
internal const val COMM_BMS_GET_VALUES = 96
internal const val COMM_GET_MCCONF = 14
internal const val COMM_GET_CUSTOM_CONFIG_XML = 92
internal const val COMM_GET_CUSTOM_CONFIG = 93
internal const val COMM_SET_CUSTOM_CONFIG = 95
internal const val COMM_PING_CAN = 62
internal const val COMM_SET_CHUCK_DATA = 35

internal const val COMM_TERMINAL_CMD = 20

internal const val COMM_PRINT = 21
internal const val REFLOAT_MAGIC = 101
internal const val REFLOAT_GET_INFO = 0
internal const val REFLOAT_GET_ALLDATA = 10
internal const val REFLOAT_RC_MOVE = 7
internal const val REFLOAT_REMOTE = 15
internal const val REFLOAT_LIGHTS_CONTROL = 20

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `REFLOAT_LIGHTS_CONTROL_LEGACY`
 */
internal const val REFLOAT_LIGHTS_CONTROL_LEGACY = 202
private const val REFLOAT_FAULT_MODE = 69

private const val VESC_FAULTS_TERMINAL_COMMAND = "faults"

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `buildFaultsTerminalCommand`
 */
internal fun buildFaultsTerminalCommand(transport: BoardTransport): ByteArray =
    transport.frame(
        byteArrayOf(COMM_TERMINAL_CMD.toByte()) + VESC_FAULTS_TERMINAL_COMMAND.toByteArray(Charsets.US_ASCII),
    )

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `LIGHTS_CONTROL_MASK`
 */
private const val LIGHTS_CONTROL_MASK = 0x3

internal data class BoardLightsState(val enabled: Boolean, val headlightsEnabled: Boolean)

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `BoardLightsGeneration`
 */
internal enum class BoardLightsGeneration {
    Legacy,

    Current;

    companion object {
        fun forBaseVersion(baseVersion: String?): BoardLightsGeneration =
            if (refloatVersionAtLeast(baseVersion, 1, 2, 0) == false) Legacy else Current
    }
}

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `lightsCommandChangesBoardConfig`
 */
internal fun lightsCommandChangesBoardConfig(baseVersion: String?): Boolean =
    refloatVersionAtLeast(baseVersion, 1, 2, 2) == false

private fun refloatVersionAtLeast(baseVersion: String?, major: Int, minor: Int, patch: Int): Boolean? {
    val parts = baseVersion?.split('.') ?: return null
    val actual = listOf(
        parts.getOrNull(0)?.toIntOrNull() ?: return null,
        parts.getOrNull(1)?.toIntOrNull() ?: 0,
        parts.getOrNull(2)?.toIntOrNull() ?: 0,
    )
    val wanted = listOf(major, minor, patch)
    val diff = actual.zip(wanted).firstOrNull { (a, w) -> a != w } ?: return true
    return diff.first > diff.second
}

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `buildLightsControlCommand`
 */
internal fun buildLightsControlCommand(
    transport: BoardTransport,
    generation: BoardLightsGeneration,
    enabled: Boolean,
    headlightsEnabled: Boolean,
): ByteArray {
    val value = (if (enabled) 0x1 else 0) or (if (headlightsEnabled) 0x2 else 0)
    val payload = when (generation) {
        BoardLightsGeneration.Current -> byteArrayOf(
            COMM_CUSTOM_APP_DATA.toByte(),
            REFLOAT_MAGIC.toByte(),
            REFLOAT_LIGHTS_CONTROL.toByte(),
            0,
            0,
            0,
            LIGHTS_CONTROL_MASK.toByte(),
            value.toByte(),
        )

        BoardLightsGeneration.Legacy -> byteArrayOf(
            COMM_CUSTOM_APP_DATA.toByte(),
            REFLOAT_MAGIC.toByte(),
            REFLOAT_LIGHTS_CONTROL_LEGACY.toByte(),
            LIGHTS_CONTROL_MASK.toByte(),
            value.toByte(),
        )
    }
    return transport.frame(payload)
}

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `parseLightsControlResponse`
 */
internal fun parseLightsControlResponse(
    payload: ByteArray,
    transport: BoardTransport? = null,
): BoardLightsState? {
    val body = when {
        payload.size >= 4 && (payload[0].toInt() and 0xff) == COMM_CUSTOM_APP_DATA -> payload
        payload.size >= 6 && (payload[0].toInt() and 0xff) == COMM_FORWARD_CAN -> {
            if (transport == BoardTransport.Direct) return null
            if (transport is BoardTransport.Can && (payload[1].toInt() and 0xff) != transport.canId) return null
            payload.copyOfRange(2, payload.size)
        }
        else -> return null
    }
    if (body.size < 4) return null
    if ((body[1].toInt() and 0xff) != REFLOAT_MAGIC) return null
    val command = body[2].toInt() and 0xff
    if (command != REFLOAT_LIGHTS_CONTROL && command != REFLOAT_LIGHTS_CONTROL_LEGACY) return null
    val bits = body[3].toInt() and 0xff
    return BoardLightsState(enabled = bits and 0x1 != 0, headlightsEnabled = bits and 0x2 != 0)
}

// @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `REMOTE_TILT_CENTER`
// @parity /src/modules/board/lib/remoteTiltPresentation.ts `TILT_CENTER`
// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltStick.kt `TILT_CENTER`
internal const val REMOTE_TILT_CENTER = 128

internal fun buildRemoteTiltCommand(transport: BoardTransport, value: Int): ByteArray {
    require(value in 0..255) { "Remote tilt value must be between 0 and 255" }
    return transport.frame(
        byteArrayOf(
            COMM_SET_CHUCK_DATA.toByte(),
            0,
            (255 - value).toByte(),
        ),
    )
}

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `BoardMoveGeneration`
 * @parity /modules/vescape-core/src/index.ts `startBoardMove`
 */
internal enum class BoardMoveGeneration {
    RcMove,

    Remote;

    companion object {
        fun forBaseVersion(baseVersion: String?): BoardMoveGeneration {
            val parts = baseVersion?.split('.') ?: return Remote
            val major = parts.getOrNull(0)?.toIntOrNull() ?: return Remote
            val minor = parts.getOrNull(1)?.toIntOrNull() ?: 0
            return if (major > 1 || (major == 1 && minor >= 3)) Remote else RcMove
        }
    }
}

internal const val BOARD_MOVE_INPUT_MAX = 127

private const val RC_MOVE_CURRENT_MAX_DECIAMPS = 60

private const val RC_MOVE_TIME_STEPS = 8

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `buildBoardMoveCommand`
 */
internal fun buildBoardMoveCommand(
    transport: BoardTransport,
    generation: BoardMoveGeneration,
    input: Int,
): ByteArray {
    require(input in -BOARD_MOVE_INPUT_MAX..BOARD_MOVE_INPUT_MAX) {
        "Board move input must be between -$BOARD_MOVE_INPUT_MAX and $BOARD_MOVE_INPUT_MAX"
    }
    val payload = when (generation) {
        BoardMoveGeneration.Remote -> byteArrayOf(
            COMM_CUSTOM_APP_DATA.toByte(),
            REFLOAT_MAGIC.toByte(),
            REFLOAT_REMOTE.toByte(),
            input.toByte(),
        )

        BoardMoveGeneration.RcMove -> {
            val direction = if (input >= 0) 1 else 0
            val current =
                abs(input) * RC_MOVE_CURRENT_MAX_DECIAMPS / BOARD_MOVE_INPUT_MAX
            val time = if (current == 0) 1 else RC_MOVE_TIME_STEPS
            byteArrayOf(
                COMM_CUSTOM_APP_DATA.toByte(),
                REFLOAT_MAGIC.toByte(),
                REFLOAT_RC_MOVE.toByte(),
                direction.toByte(),
                current.toByte(),
                time.toByte(),
                (current + time).toByte(),
            )
        }
    }
    return transport.frame(payload)
}

internal fun parseFwVersion(payload: ByteArray): String? {
    if (payload.size < 3) return null
    val major = payload[1].toInt() and 0xff
    val minor = payload[2].toInt() and 0xff
    var hwNameEnd = 3
    while (hwNameEnd < payload.size && payload[hwNameEnd] != 0.toByte()) hwNameEnd++
    val hwName = if (hwNameEnd > 3) String(payload, 3, hwNameEnd - 3, Charsets.UTF_8) else null
    var offset = hwNameEnd + 1 + 15
    val customConfigs = mutableListOf<String>()
    if (offset < payload.size) {
        val count = payload[offset].toInt() and 0xff
        offset++
        for (i in 0 until count) {
            val start = offset
            while (offset < payload.size && payload[offset] != 0.toByte()) offset++
            if (offset > start) customConfigs.add(String(payload, start, offset - start, Charsets.UTF_8))
            offset++
        }
    }
    return buildList {
        add("FW $major.${"%02d".format(minor)}")
        hwName?.let(::add)
        if (customConfigs.isNotEmpty()) add(customConfigs.joinToString(", "))
    }.joinToString(" · ")
}

internal object VescPacketCodec {
    fun encode(payload: ByteArray): ByteArray {
        val short = payload.size <= 255
        val frame = ByteArray((if (short) 2 else 3) + payload.size + 3)
        var offset = 0
        if (short) {
            frame[offset++] = 0x02
            frame[offset++] = payload.size.toByte()
        } else {
            frame[offset++] = 0x03
            frame[offset++] = ((payload.size shr 8) and 0xff).toByte()
            frame[offset++] = (payload.size and 0xff).toByte()
        }
        payload.copyInto(frame, offset)
        offset += payload.size
        val crc = crc16(payload)
        frame[offset++] = ((crc shr 8) and 0xff).toByte()
        frame[offset++] = (crc and 0xff).toByte()
        frame[offset] = 0x03
        return frame
    }
}

internal class VescPacketReassembler {
    private val buffer = ArrayList<Byte>()

    fun reset() {
        buffer.clear()
    }

    fun feed(chunk: ByteArray): List<ByteArray> {
        chunk.forEach { buffer.add(it) }
        val packets = mutableListOf<ByteArray>()
        while (buffer.isNotEmpty()) {
            val start = buffer[0].toInt() and 0xff
            if (start != 0x02 && start != 0x03) {
                buffer.removeAt(0)
                continue
            }
            val headerLen = if (start == 0x02) 2 else 3
            if (buffer.size < headerLen) break
            val len = if (start == 0x02) {
                buffer[1].toInt() and 0xff
            } else {
                ((buffer[1].toInt() and 0xff) shl 8) or (buffer[2].toInt() and 0xff)
            }
            val total = headerLen + len + 3
            if (buffer.size < total) break
            if ((buffer[total - 1].toInt() and 0xff) != 0x03) {
                buffer.removeAt(0)
                continue
            }
            val payload = ByteArray(len)
            for (i in 0 until len) payload[i] = buffer[headerLen + i]
            val actual = ((buffer[headerLen + len].toInt() and 0xff) shl 8) or
                (buffer[headerLen + len + 1].toInt() and 0xff)
            if (crc16(payload) == actual) {
                packets.add(payload)
                repeat(total) { buffer.removeAt(0) }
            } else {
                buffer.removeAt(0)
            }
        }
        return packets
    }
}

internal fun parseRefloatGetAllData(
    payload: ByteArray,
    avgLatency: Int?,
    packetAt: Long,
    location: LocationSnapshot?,
    pullRateHz: Double? = null,
): RefloatTelemetry? {
    if (payload.size < 5) return null
    if ((payload[0].toInt() and 0xff) != COMM_CUSTOM_APP_DATA) return null
    if ((payload[1].toInt() and 0xff) != REFLOAT_MAGIC) return null
    if ((payload[2].toInt() and 0xff) != REFLOAT_GET_ALLDATA) return null

    val mode = payload[3].toInt() and 0xff
    if (mode == REFLOAT_FAULT_MODE) {
        return RefloatTelemetry(
            hasFault = true,
            faultCode = payload.getOrNull(4)?.toInt()?.and(0xff) ?: 0,
            pitch = 0.0,
            roll = 0.0,
            balancePitch = 0.0,
            balanceCurrent = 0.0,
            speed = 0.0,
            batteryVoltage = 0.0,
            motorCurrent = 0.0,
            batteryCurrent = 0.0,
            erpm = 0,
            dutyCycle = 0.0,
            state = 0,
            switchState = 0,
            adc1 = 0.0,
            adc2 = 0.0,
            odometer = null,
            tempMosfet = null,
            tempMotor = null,
            avgLatency = avgLatency,
            pullRateHz = pullRateHz,
            lastPacketAt = packetAt,
            location = location,
        )
    }
    if (payload.size < 34) return null

    val pitch = int16(payload, 20) / 10.0
    val speed = (int16(payload, 27) / 10.0) * 3.6
    val state = payload[10].toInt() and 0xff
    val odometer = if (mode >= 2 && payload.size >= 42) float32Auto(payload, 35) else null
    val dutyRaw = (payload[33].toInt() and 0xff) - 128
    val dutyCycle = if (abs(dutyRaw) <= 1) 0.0 else dutyRaw / 100.0
    return RefloatTelemetry(
        hasFault = false,
        faultCode = 0,
        pitch = pitch,
        roll = int16(payload, 8) / 10.0,
        balancePitch = int16(payload, 6) / 10.0,
        balanceCurrent = int16(payload, 4) / 10.0,
        speed = speed,
        batteryVoltage = int16(payload, 23) / 10.0,
        motorCurrent = int16(payload, 29) / 10.0,
        batteryCurrent = int16(payload, 31) / 10.0,
        erpm = int16(payload, 25),
        dutyCycle = dutyCycle,
        state = state,
        switchState = payload[11].toInt() and 0xff,
        adc1 = (payload[12].toInt() and 0xff) / 50.0,
        adc2 = (payload[13].toInt() and 0xff) / 50.0,
        odometer = odometer,
        tempMosfet = if (mode >= 2 && payload.size >= 42) (payload[39].toInt() and 0xff) / 2.0 else null,
        tempMotor = if (mode >= 2 && payload.size >= 42) (payload[40].toInt() and 0xff) / 2.0 else null,
        avgLatency = avgLatency,
        pullRateHz = pullRateHz,
        lastPacketAt = packetAt,
        location = location,
    )
}

internal fun parseBmsValues(payload: ByteArray, packetAt: Long): BmsTelemetry? {
    if (payload.isEmpty()) return null
    if ((payload[0].toInt() and 0xff) != COMM_BMS_GET_VALUES) return null
    if (payload.size < 26) return null

    var ind = 1
    val voltageTotal = int32(payload, ind) / 1e6; ind += 4
    val vCharge = int32(payload, ind) / 1e6; ind += 4
    val current = int32(payload, ind) / 1e6; ind += 4
    val currentIc = int32(payload, ind) / 1e6; ind += 4
    val ampHours = int32(payload, ind) / 1e3; ind += 4
    val wattHours = int32(payload, ind) / 1e3; ind += 4

    val cellNum = payload[ind].toInt() and 0xff; ind += 1
    if (cellNum <= 0 || cellNum > 60) return null
    if (payload.size < ind + cellNum * 2) return null

    val cellVoltages = DoubleArray(cellNum)
    for (i in 0 until cellNum) {
        cellVoltages[i] = int16(payload, ind) / 1e3
        ind += 2
    }

    val balancing = BooleanArray(cellNum)
    if (payload.size >= ind + cellNum) {
        for (i in 0 until cellNum) {
            balancing[i] = (payload[ind].toInt() and 0xff) != 0
            ind += 1
        }
    }

    var temps: List<Double> = emptyList()
    var tempIc: Double? = null
    var tempHum: Double? = null
    var humidity: Double? = null
    var tempMaxCell: Double? = null
    var soc: Double? = null
    var soh: Double? = null
    var canId: Int? = null

    if (payload.size > ind) {
        val tempAdcNum = payload[ind].toInt() and 0xff; ind += 1
        if (tempAdcNum in 0..30 && payload.size >= ind + tempAdcNum * 2) {
            val t = DoubleArray(tempAdcNum)
            for (i in 0 until tempAdcNum) {
                t[i] = int16(payload, ind) / 1e2
                ind += 2
            }
            temps = t.toList()
            if (payload.size >= ind + 8) {
                tempIc = int16(payload, ind) / 1e2; ind += 2
                tempHum = int16(payload, ind) / 1e2; ind += 2
                humidity = int16(payload, ind) / 1e2; ind += 2
                tempMaxCell = int16(payload, ind) / 1e2; ind += 2
            }
            if (payload.size > ind) { soc = (payload[ind].toInt() and 0xff) / 255.0; ind += 1 }
            if (payload.size > ind) { soh = (payload[ind].toInt() and 0xff) / 255.0; ind += 1 }
            if (payload.size > ind) { canId = payload[ind].toInt() and 0xff; ind += 1 }
        }
    }

    return BmsTelemetry(
        capturedAt = packetAt,
        voltageTotal = voltageTotal,
        vCharge = vCharge,
        current = current,
        currentIc = currentIc,
        ampHours = ampHours,
        wattHours = wattHours,
        soc = soc,
        soh = soh,
        cellVoltages = cellVoltages.toList(),
        balancing = balancing.toList(),
        temps = temps,
        tempIc = tempIc,
        tempHum = tempHum,
        humidity = humidity,
        tempMaxCell = tempMaxCell,
        canId = canId,
    )
}

private fun crc16(data: ByteArray): Int {
    var crc = 0
    for (b in data) {
        crc = crc xor ((b.toInt() and 0xff) shl 8)
        repeat(8) {
            crc = if ((crc and 0x8000) != 0) {
                ((crc shl 1) xor 0x1021) and 0xffff
            } else {
                (crc shl 1) and 0xffff
            }
        }
    }
    return crc and 0xffff
}

private fun int16(bytes: ByteArray, offset: Int): Int {
    return ByteBuffer.wrap(bytes, offset, 2).order(ByteOrder.BIG_ENDIAN).short.toInt()
}

private fun int32(bytes: ByteArray, offset: Int): Int {
    return ByteBuffer.wrap(bytes, offset, 4).order(ByteOrder.BIG_ENDIAN).int
}

private fun float32Auto(bytes: ByteArray, offset: Int): Double {
    val raw = ByteBuffer.wrap(bytes, offset, 4).order(ByteOrder.BIG_ENDIAN).int
    val eRaw = (raw ushr 23) and 0xff
    val sigI = raw and 0x7fffff
    val neg = (raw ushr 31) != 0
    if (eRaw == 0 && sigI == 0) return 0.0
    val sig = sigI / (8388608.0 * 2.0) + 0.5
    val result = sig * 2.0.pow(eRaw - 126)
    return if (neg) -result else result
}
