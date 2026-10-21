package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LiveWindowPeakTest {

    private fun row(speed: Double?) = mapOf<String, Any?>("speed" to speed)
    private fun peak() = LiveWindowPeak { (it["speed"] as? Double) }

    @Test
    fun `tracks the highest sample added`() {
        val p = peak()
        val window = listOf(row(10.0), row(30.0), row(null), row(20.0))
        window.forEach(p::add)
        assertEquals(30.0, p.value(window)!!, 0.0)
    }

    @Test
    fun `falls back to the next highest when the peak rolls off`() {
        val p = peak()
        val window = ArrayDeque(listOf(row(30.0), row(10.0), row(20.0)))
        window.forEach(p::add)
        p.evict(window.removeFirst())
        assertEquals(20.0, p.value(window)!!, 0.0)
    }

    @Test
    fun `invalidate rescans after past samples change`() {
        val p = peak()
        val window = listOf(mutableMapOf<String, Any?>("speed" to 30.0), mutableMapOf<String, Any?>("speed" to 10.0))
        window.forEach(p::add)
        window[0]["speed"] = null
        p.invalidate()
        assertEquals(10.0, p.value(window)!!, 0.0)
    }

    @Test
    fun `reset forgets the peak`() {
        val p = peak()
        p.add(row(30.0))
        p.reset()
        assertNull(p.value(emptyList()))
    }
}
