package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.alerts.AlertPresetSpec
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertPresetGeneratorTest {
  @Test
  fun `battery preset stays dormant without config but expands for OneWheel native SoC`() {
    val spec = requireNotNull(AlertPresetSpec.parse("preset(normal)"))

    assertTrue(AlertPresetGenerator.generate("battery", spec, PresetInput()).isEmpty())
    assertFalse(
      AlertPresetGenerator.generate(
        "battery",
        spec,
        PresetInput(hasNativeBatteryPercent = true),
      ).isEmpty(),
    )
  }
}
