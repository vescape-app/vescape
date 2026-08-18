package expo.modules.vescapecore.connection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CompanionBoardSelectionTest {
    private val boards = listOf(
        mapOf<String, Any?>(
            "id" to "board-a",
            "link" to mapOf("bleId" to "AA:AA:AA:AA:AA:AA"),
        ),
        mapOf<String, Any?>(
            "id" to "board-b",
            "link" to mapOf("bleId" to "BB:BB:BB:BB:BB:BB"),
        ),
    )

    @Test
    fun `matches any linked board by BLE address`() {
        assertEquals(
            "board-b",
            companionBoardIdForAddress(boards, "bb:bb:bb:bb:bb:bb"),
        )
    }

    @Test
    fun `ignores unknown addresses`() {
        assertNull(companionBoardIdForAddress(boards, "CC:CC:CC:CC:CC:CC"))
    }
}
