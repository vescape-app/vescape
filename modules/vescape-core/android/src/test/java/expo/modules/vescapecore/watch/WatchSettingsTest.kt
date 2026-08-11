package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.AppSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchSettingsTest {
    @Test
    fun `the rider colour rides to the wrist as the phone stores it`() {
        assertEquals("#38bdf8", AppSettings(riderColor = "#38bdf8").toWatchSettings().riderColor)
    }

    @Test
    fun `an unset colour is null so the wrist keeps its own palette`() {
        assertNull(AppSettings(riderColor = null).toWatchSettings().riderColor)
        assertNull(AppSettings(riderColor = "   ").toWatchSettings().riderColor)
    }

    @Test
    fun `board move strength rides along so the wrist can show what a hold will do`() {
        assertEquals(35, AppSettings(boardMoveStrengthPercent = 35).toWatchSettings().boardMoveStrengthPercent)
    }

    @Test
    fun `settings equality is what decides whether a push is worth a round trip`() {
        val settings = AppSettings(riderColor = "#38bdf8")
        assertEquals(settings.toWatchSettings(), settings.copy(telemetryPollRateHz = 5).toWatchSettings())
    }
}
