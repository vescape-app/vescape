package expo.modules.vescapecore.watch

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import expo.modules.vescapecore.telemetry.AppSettings
import org.junit.Assert.assertEquals
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/WatchColdStateTests.swift */
class WatchSettingsPusherTest {
    @Test
    fun `cold writes retain latest preference without a board and retry a failed write`() {
        var retained: WatchSettings? = null
        var failing = false
        var writes = 0
        val events = mutableListOf<String>()
        fun newPublisher() = WatchSettingsPusher(
            write = { if (failing) error("unavailable") else { retained = it; writes++ } },
            scope = CoroutineScope(Dispatchers.Unconfined),
            record = { name, _ -> events.add(name) },
        )
        val publisher = newPublisher()
        val metric = AppSettings().toWatchSettings()
        val imperial = AppSettings(unitSystem = "imperial").toWatchSettings()
        publisher.push(metric)
        publisher.push(metric)
        assertEquals(1, writes)
        failing = true
        publisher.push(imperial)
        assertEquals(metric, retained)
        assertEquals(listOf("watch_settings_push_failed"), events)
        failing = false
        publisher.push(imperial)
        assertEquals(imperial, retained)
        // The Data Layer retains the last item offline; a phone restart republishes that preference.
        newPublisher().push(imperial)
        assertEquals(imperial, retained)
        assertEquals(3, writes)
    }
}
