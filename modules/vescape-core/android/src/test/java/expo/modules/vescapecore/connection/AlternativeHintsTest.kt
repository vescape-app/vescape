package expo.modules.vescapecore.connection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Advisory switch hints (ADR 0035, #408): dedup by saved Board id, discovery order, and expiry
 * thirty seconds after the *last* advertisement.
 *
 * @parity /modules/vescape-core/ios/connection/AlternativeHintsTests.swift
 */
class AlternativeHintsTest {
    private fun observation(
        boardId: String,
        observedAtMs: Long = 0L,
        rssi: Int? = -60,
        selected: Boolean = false,
    ) = PresenceObservation(
        boardId = boardId,
        bleId = "ble:$boardId",
        name = boardId.uppercase(),
        rssi = rssi,
        observedAtMs = observedAtMs,
        selected = selected,
    )

    @Test
    fun `a repeated advertisement refreshes in place instead of queueing a second hint`() {
        val first = AlternativeHints.upsert(emptyList(), observation("a", observedAtMs = 1_000L))
        assertTrue(first.isNew)

        val again = AlternativeHints.upsert(
            first.observations,
            observation("a", observedAtMs = 9_000L, rssi = -42),
        )
        assertFalse(again.isNew)
        assertEquals(1, again.observations.size)
        assertEquals(9_000L, again.observations[0].observedAtMs)
        assertEquals(-42, again.observations[0].rssi)
    }

    @Test
    fun `discovery order survives a refresh of an earlier Board`() {
        var list = AlternativeHints.upsert(emptyList(), observation("a", 1_000L)).observations
        list = AlternativeHints.upsert(list, observation("b", 2_000L)).observations
        list = AlternativeHints.upsert(list, observation("a", 3_000L)).observations

        assertEquals(listOf("a", "b"), list.map { it.boardId })
    }

    @Test
    fun `an observation expires thirty seconds after its last advertisement`() {
        val seen = observation("a", observedAtMs = 1_000L)
        assertFalse(AlternativeHints.isExpired(seen, nowMs = 1_000L + ALTERNATIVE_HINT_TTL_MS - 1))
        assertTrue(AlternativeHints.isExpired(seen, nowMs = 1_000L + ALTERNATIVE_HINT_TTL_MS))

        // The refreshed copy restarts the window from the newer advertisement.
        val refreshed = AlternativeHints.upsert(listOf(seen), observation("a", observedAtMs = 20_000L))
        assertFalse(
            AlternativeHints.isExpired(refreshed.observations[0], nowMs = 1_000L + ALTERNATIVE_HINT_TTL_MS),
        )
    }

    @Test
    fun `pruning a snapshot drops only the aged-out observations`() {
        val state = PresenceScanState(
            observations = listOf(observation("old", 0L), observation("fresh", 25_000L)),
        )
        val pruned = AlternativeHints.prune(state, nowMs = 31_000L)
        assertEquals(listOf("fresh"), pruned.observations.map { it.boardId })

        // Nothing to drop ⇒ the same snapshot, not a copy.
        assertTrue(AlternativeHints.prune(state, nowMs = 25_000L) === state)
    }
}
