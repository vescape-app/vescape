package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class BatterySocEstimatorTest {

    @Before
    fun setUp() {
        val json = javaClass.classLoader!!.getResourceAsStream("data/cell-presets.json")!!
            .bufferedReader().readText()
        BatterySocEstimator.loadPresets(json)
    }

    @Test
    fun `preset config estimates state of charge from per-cell curve`() {
        val config = mapOf<String, Any?>(
            "mode" to "preset",
            "cellPresetId" to "molicel:21700:p50b",
            "seriesCount" to 20,
            "parallelCount" to 2,
        )

        assertEquals(100.0, BatterySocEstimator.estimateBatteryPercent(84.0, config)!!, 0.0)
        assertEquals(0.0, BatterySocEstimator.estimateBatteryPercent(50.0, config)!!, 0.0)
        assertEquals(55.0, BatterySocEstimator.estimateBatteryPercent(76.0, config)!!, 3.0)
    }

    @Test
    fun `manual config estimates state of charge`() {
        val config = mapOf<String, Any?>(
            "mode" to "manual",
            "minVoltage" to 60.0,
            "maxVoltage" to 84.0,
        )

        assertEquals(100.0, BatterySocEstimator.estimateBatteryPercent(84.0, config)!!, 0.0)
        assertEquals(0.0, BatterySocEstimator.estimateBatteryPercent(60.0, config)!!, 0.0)
    }

    @Test
    fun `returns null for missing or unknown preset configs`() {
        assertNull(BatterySocEstimator.estimateBatteryPercent(72.0, null))
        assertNull(
            BatterySocEstimator.estimateBatteryPercent(
                72.0,
                mapOf(
                    "mode" to "preset",
                    "cellPresetId" to "missing",
                    "seriesCount" to 20,
                    "parallelCount" to 2,
                ),
            ),
        )
    }

    @Test
    fun `returns null for invalid manual config`() {
        assertNull(
            BatterySocEstimator.estimateBatteryPercent(
                72.0,
                mapOf("mode" to "manual", "minVoltage" to 84.0, "maxVoltage" to 60.0),
            ),
        )
    }

    @Test
    fun `clamps to 100 percent when voltage above max`() {
        val config = mapOf<String, Any?>(
            "mode" to "manual",
            "minVoltage" to 60.0,
            "maxVoltage" to 84.0,
        )

        assertEquals(100.0, BatterySocEstimator.estimateBatteryPercent(90.0, config)!!, 0.0)
    }

    @Test
    fun `clamps to 0 percent when voltage below min`() {
        val config = mapOf<String, Any?>(
            "mode" to "manual",
            "minVoltage" to 60.0,
            "maxVoltage" to 84.0,
        )

        assertEquals(0.0, BatterySocEstimator.estimateBatteryPercent(50.0, config)!!, 0.0)
    }

    @Test
    fun `returns null for empty config map`() {
        assertNull(BatterySocEstimator.estimateBatteryPercent(72.0, emptyMap()))
    }

    @Test
    fun `manual interpolation returns correct mid-range values`() {
        val config = mapOf<String, Any?>(
            "mode" to "manual",
            "minVoltage" to 50.0,
            "maxVoltage" to 100.0,
        )

        val mid = BatterySocEstimator.estimateBatteryPercent(75.0, config)
        assertNotNull(mid)
        assertTrue(mid!! > 0.0 && mid < 100.0)
    }

    @Test
    fun `preset behaves correctly at known voltages`() {
        val config = mapOf<String, Any?>(
            "mode" to "preset",
            "cellPresetId" to "molicel:21700:p50b",
            "seriesCount" to 20,
            "parallelCount" to 2,
        )

        assertEquals(100.0, BatterySocEstimator.estimateBatteryPercent(84.0, config)!!, 0.0)
        assertEquals(0.0, BatterySocEstimator.estimateBatteryPercent(50.0, config)!!, 0.0)
        assertNotNull(BatterySocEstimator.estimateBatteryPercent(76.0, config))
    }

    @Test
    fun `returns null for unknown cell preset`() {
        assertNull(BatterySocEstimator.getCellPreset("unknown:cell:id"))
    }

    @Test
    fun `preset IR compensation boosts SoC under load`() {
        val config = mapOf<String, Any?>(
            "mode" to "preset",
            "cellPresetId" to "molicel:21700:p50b",
            "seriesCount" to 20,
            "parallelCount" to 2,
        )
        val noLoad = BatterySocEstimator.estimateBatteryPercent(72.0, config, 0.0)!!
        val withLoad = BatterySocEstimator.estimateBatteryPercent(72.0, config, 30.0)!!
        assertTrue("IR compensation should increase SoC under load", withLoad > noLoad)
    }

    @Test
    fun `zero current produces same result as no current`() {
        val config = mapOf<String, Any?>(
            "mode" to "preset",
            "cellPresetId" to "molicel:21700:p50b",
            "seriesCount" to 20,
            "parallelCount" to 2,
        )
        val withDefault = BatterySocEstimator.estimateBatteryPercent(76.0, config)!!
        val withZero = BatterySocEstimator.estimateBatteryPercent(76.0, config, 0.0)!!
        assertEquals(withDefault, withZero, 0.001)
    }

    @Test
    fun `manual config IR compensation uses fallback resistance`() {
        val config = mapOf<String, Any?>(
            "mode" to "manual",
            "minVoltage" to 60.0,
            "maxVoltage" to 84.0,
        )
        val noLoad = BatterySocEstimator.estimateBatteryPercent(70.0, config, 0.0)!!
        val withLoad = BatterySocEstimator.estimateBatteryPercent(70.0, config, 20.0)!!
        assertTrue("Manual mode IR compensation should increase SoC under load", withLoad > noLoad)
    }

    @Test
    fun `missing config returns null even with current`() {
        assertNull(BatterySocEstimator.estimateBatteryPercent(72.0, null, 30.0))
    }
}
