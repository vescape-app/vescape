package expo.modules.vescapecore.accessory

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The NDJSON framing contract, driven by `shared/fixtures/accessory-protocol/framing.json`. Chunks
 * arrive as bytes so the cases can split a line mid-UTF-8-character, which is exactly what a BLE
 * notification boundary does.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryNdjsonFramerTests.swift
 */
class AccessoryNdjsonFramerTest {
    private val fixture = AccessoryFixtures.load("framing.json")

    @Test
    fun everyFramingCaseMatchesTheSharedFixture() {
        val maxLineBytes = fixture.getInt("maxLineBytes")
        assertEquals(
            "framer default must be the documented protocol limit",
            maxLineBytes,
            AccessoryProtocol.MAX_LINE_BYTES,
        )

        val cases = fixture.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val name = case.getString("name")
            val framer = AccessoryNdjsonFramer(maxLineBytes)
            val chunks = case.getJSONArray("chunksHex")
            val lines = mutableListOf<String>()
            var failure: AccessoryFramingError? = null
            for (c in 0 until chunks.length()) {
                val result = framer.feed(AccessoryFixtures.hexToBytes(chunks.getString(c)))
                lines.addAll(result.lines)
                failure = failure ?: result.failure
                assertTrue(
                    "$name: the buffer must never exceed the protocol line limit",
                    framer.bufferedBytes <= maxLineBytes,
                )
            }

            val expectedLines = case.getJSONArray("lines")
            assertEquals("$name: line count", expectedLines.length(), lines.size)
            for (l in 0 until expectedLines.length()) {
                assertEquals("$name: line $l", expectedLines.getString(l), lines[l])
            }

            if (case.isNull("failure")) {
                assertNull("$name: expected no framing failure", failure)
            } else {
                assertEquals("$name: failure", case.getString("failure"), failure?.wire)
            }
        }
    }

    @Test
    fun aPeerThatNeverSendsALineFeedCostsAFixedBuffer() {
        val framer = AccessoryNdjsonFramer()
        // Ten times the limit, in chunks, with no LF anywhere: an unbounded accumulator would hold
        // all of it. The framer must give up at the limit and stay terminal.
        val chunk = ByteArray(1024) { 'x'.code.toByte() }
        var failure: AccessoryFramingError? = null
        repeat(40) {
            failure = failure ?: framer.feed(chunk).failure
            assertTrue(framer.bufferedBytes <= AccessoryProtocol.MAX_LINE_BYTES)
        }
        assertEquals(AccessoryFramingError.OVERSIZED, failure)
        assertTrue(framer.failed)
        assertEquals(0, framer.bufferedBytes)
    }

    @Test
    fun resetClearsAFailedStreamForTheNextSession() {
        val framer = AccessoryNdjsonFramer(16)
        assertEquals(
            AccessoryFramingError.OVERSIZED,
            framer.feed(ByteArray(32) { 'x'.code.toByte() }).failure,
        )
        framer.reset()
        val result = framer.feed("{\"a\":1}\n".toByteArray())
        assertEquals(listOf("{\"a\":1}"), result.lines)
        assertNull(result.failure)
    }
}
