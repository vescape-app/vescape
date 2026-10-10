package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/telemetry/IdlePauseDetectorTests.swift */
class IdlePauseDetectorTest {
  @Test
  fun `disengagement pauses immediately and repeated samples do not repeat transitions`() {
    val d = IdlePauseDetector()
    assertNull(d.onSample(1))
    assertEquals(IdlePauseTransition.Paused, d.onSample(9))
    assertTrue(d.isPaused)
    assertNull(d.onSample(9))
    assertNull(d.onSample(6))
    assertEquals(IdlePauseTransition.Resumed, d.onSample(1))
    assertFalse(d.isPaused)
    assertNull(d.onSample(1))
    assertNull(d.onSample(2))
    assertNull(d.onSample(3))
    assertEquals(IdlePauseTransition.Paused, d.onSample(9))
  }

  @Test
  fun `all packed states use only the engagement nibble`() {
    for (sat in 0..15) {
      for (state in 0..15) {
        val d = IdlePauseDetector()
        d.onSample(9)
        val transition = d.onSample((sat shl 4) or state)
        if (state in 1..3) {
          assertEquals(IdlePauseTransition.Resumed, transition)
          assertFalse(d.isPaused)
        } else {
          assertNull(transition)
          assertTrue(d.isPaused)
        }
      }
    }
  }

  @Test
  fun `reset clears the old session and next disengaged sample pauses immediately`() {
    val d = IdlePauseDetector()
    assertEquals(IdlePauseTransition.Paused, d.onSample(0))
    d.reset()
    assertFalse(d.isPaused)
    assertNull(d.onSample(1))
    assertEquals(IdlePauseTransition.Paused, d.onSample(15))
  }
}
