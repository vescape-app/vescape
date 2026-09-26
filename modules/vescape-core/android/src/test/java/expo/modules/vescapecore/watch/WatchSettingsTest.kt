package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.AppSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchSettingsTest {
    /**
     * Regression: `boardMoveStrengthPercent` was missing from the reload list, so a strength change
     * never reached the watch. Every mirrored field needs its key in the list, and vice versa.
     */
    @Test
    fun `every mirrored setting has its key in the reload list`() {
        val changedByKey = mapOf(
            "riderColor" to AppSettings(riderColor = "#ff0000"),
            "boardMoveStrengthPercent" to AppSettings(boardMoveStrengthPercent = 30),
            "wearNavArrowEnabled" to AppSettings(wearNavArrowEnabled = true),
            "unitSystem" to AppSettings(unitSystem = "imperial"),
            "wearTiltRatePercent" to AppSettings(wearTiltRatePercent = 40),
        )
        val mirroredFields = WatchSettings::class.java.declaredFields.count { !java.lang.reflect.Modifier.isStatic(it.modifiers) }
        assertEquals(mirroredFields, changedByKey.size)
        assertEquals(WATCH_SOURCE_SETTING_KEYS - "wearPushRateHz", changedByKey.keys)
        for (changed in changedByKey.values) {
            org.junit.Assert.assertNotEquals(AppSettings().toWatchSettings(), changed.toWatchSettings())
        }
    }

    @Test
    fun `unit preference belongs to cold settings and invalidates equality`() {
        val metric = AppSettings().toWatchSettings()
        val imperial = AppSettings(unitSystem = "imperial").toWatchSettings()
        assertEquals("metric", metric.unitSystem)
        assertEquals("imperial", imperial.unitSystem)
        org.junit.Assert.assertNotEquals(metric, imperial)
        assertEquals(imperial, AppSettings(unitSystem = "imperial", telemetryPollRateHz = 5).toWatchSettings())
    }

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
