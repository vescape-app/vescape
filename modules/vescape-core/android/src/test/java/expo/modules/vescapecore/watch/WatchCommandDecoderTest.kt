package expo.modules.vescapecore.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchCommandDecoderTest {
    @Test
    fun `a move command decodes to its clamped direction`() {
        assertEquals(WatchCommand.Move(1), WatchCommandDecoder.decode(byteArrayOf(1, 1)))
        assertEquals(WatchCommand.Move(-1), WatchCommandDecoder.decode(byteArrayOf(1, -1)))
        assertEquals(WatchCommand.Move(1), WatchCommandDecoder.decode(byteArrayOf(1, 127)))
    }

    @Test
    fun `a wake level command decodes to its level`() {
        assertEquals(
            WatchCommand.MirrorAwake(WatchMirrorWakeLevel.ASLEEP),
            WatchCommandDecoder.decode(byteArrayOf(2, 0)),
        )
        assertEquals(
            WatchCommand.MirrorAwake(WatchMirrorWakeLevel.AMBIENT),
            WatchCommandDecoder.decode(byteArrayOf(2, 2)),
        )
    }

    @Test
    fun `a lights command decodes bit0 as the target and bit1 as the switch`() {
        assertEquals(
            WatchCommand.Lights(WatchLightsSwitch.LEDS, false),
            WatchCommandDecoder.decode(byteArrayOf(3, 0b00)),
        )
        assertEquals(
            WatchCommand.Lights(WatchLightsSwitch.LEDS, true),
            WatchCommandDecoder.decode(byteArrayOf(3, 0b01)),
        )
        assertEquals(
            WatchCommand.Lights(WatchLightsSwitch.HEADLIGHT, false),
            WatchCommandDecoder.decode(byteArrayOf(3, 0b10)),
        )
        assertEquals(
            WatchCommand.Lights(WatchLightsSwitch.HEADLIGHT, true),
            WatchCommandDecoder.decode(byteArrayOf(3, 0b11)),
        )
    }

    @Test
    fun `a tilt lock decodes the whole unsigned range, and cancel carries no value`() {
        assertEquals(WatchCommand.TiltLock(0), WatchCommandDecoder.decode(byteArrayOf(4, 0)))
        assertEquals(WatchCommand.TiltLock(128), WatchCommandDecoder.decode(byteArrayOf(4, 128.toByte())))
        assertEquals(WatchCommand.TiltLock(255), WatchCommandDecoder.decode(byteArrayOf(4, -1)))
        assertEquals(WatchCommand.TiltCancel, WatchCommandDecoder.decode(byteArrayOf(5, 0)))
    }

    @Test
    fun `an unknown kind or wake level is dropped rather than guessed`() {
        assertNull(WatchCommandDecoder.decode(byteArrayOf(9, 1)))
        assertNull(WatchCommandDecoder.decode(byteArrayOf(2, 7)))
        assertNull(WatchCommandDecoder.decode(byteArrayOf(2)))
        assertNull(WatchCommandDecoder.decode(byteArrayOf(3, 0b100)))
        assertNull(WatchCommandDecoder.decode(byteArrayOf(3)))
    }
}
