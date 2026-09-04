package expo.modules.vescapecore.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Wire contract with the wrist ([app.vescape.wear.WatchCommand]); a misread here moves a board. */
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

    /** A wrist newer than the phone must read as "unknown", never as a neighbouring level. */
    @Test
    fun `an unknown kind or wake level is dropped rather than guessed`() {
        assertNull(WatchCommandDecoder.decode(byteArrayOf(9, 1)))
        assertNull(WatchCommandDecoder.decode(byteArrayOf(2, 7)))
        assertNull(WatchCommandDecoder.decode(byteArrayOf(2)))
        // Bits above the two this kind defines belong to a wrist this phone does not understand.
        assertNull(WatchCommandDecoder.decode(byteArrayOf(3, 0b100)))
        assertNull(WatchCommandDecoder.decode(byteArrayOf(3)))
    }
}
