package app.vescape.wear

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class WatchCommandTest {
    @Test
    fun `a move command is a kind byte and a direction byte`() {
        assertArrayEquals(byteArrayOf(1, 1), encodeMoveCommand(1))
        assertArrayEquals(byteArrayOf(1, -1), encodeMoveCommand(-1))
        assertArrayEquals(byteArrayOf(1, 0), encodeMoveCommand(0))
    }

    @Test
    fun `a direction is clamped so the wrist can never ask for more than one board move`() {
        assertArrayEquals(byteArrayOf(1, 1), encodeMoveCommand(127))
        assertArrayEquals(byteArrayOf(1, -1), encodeMoveCommand(-127))
    }
}
