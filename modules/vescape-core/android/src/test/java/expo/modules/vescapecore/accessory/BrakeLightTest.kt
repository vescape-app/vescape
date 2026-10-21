package expo.modules.vescapecore.accessory
import org.junit.Assert.*
import org.junit.Test

/** @parity /modules/vescape-core/ios/accessory/BrakeLightTests.swift */
class BrakeLightTest {
 @Test fun forwardAndReverseDecelerationAndSteadySpeed() {
  for (direction in listOf(1, -1)) {
   val detector = BrakeLightDetector()
   for (n in 0..10) detector.sample(direction * 36.0, true, n * 100L, 50)
   assertEquals("riding", detector.mode)
   for (n in 1..10) detector.sample(direction * (36.0 - n * 0.72), true, 1000L + n * 100, 50)
   assertEquals("braking", detector.mode)
   for (n in 1..8) detector.sample(direction * (28.8 - n * 1.8), true, 2000L + n * 100, 50)
   assertEquals("hard_braking", detector.mode)
  }
 }
 @Test fun gapInvalidSpeedAndParkedClearHistory() {
  val detector = BrakeLightDetector()
  detector.sample(36.0, true, 0, 50)
  detector.sample(0.0, true, 1000, 50)
  assertNull(detector.mode)
  detector.sample(0.0, true, 1100, 50)
  assertEquals("riding", detector.mode)
  detector.sample(Double.NaN, true, 1200, 50)
  assertNull(detector.mode)
  detector.sample(0.0, false, 1300, 50)
  assertEquals("not_riding", detector.mode)
 }
 @Test fun sensitivityChangesThresholdAndPreviewRestoresCurrentState() {
  val gentle = BrakeLightDetector(); val resistant = BrakeLightDetector()
  for (n in 0..15) {
   gentle.sample(36.0 - n * 0.36, true, n * 100L, 100)
   resistant.sample(36.0 - n * 0.36, true, n * 100L, 1)
  }
  assertEquals("braking", gentle.mode); assertEquals("riding", resistant.mode)
  val controller = BrakeLightController(); val key = BrakeLightController.Key("a", "rear")
  controller.configure(key, BrakeLightSettings(50, "glow"))
  assertTrue(controller.preview(key, "hard_braking"))
  assertEquals("unavailable", controller.command(key).telemetry)
  assertTrue(controller.command(key).preview)
  controller.releasePreviews()
  assertNull(controller.command(key).mode)
  controller.sample(10.0, true, 100)
  assertFalse(controller.preview(key, "braking"))
  assertEquals("riding", controller.command(key).mode)
  controller.clear()
  assertEquals("unavailable", controller.command(key).telemetry)
  assertEquals("glow", controller.command(key).parked)
 }
}
