package expo.modules.vescapecore.warnings

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/warnings/BoardWarningPayloadTests.swift
 */
class BoardWarningKindTest {
  @Test
  fun round4RoundsTiesAwayFromZero() {
    assertEquals(0.1235, boardWarningRound4(0.12345), 0.0)
    assertEquals(-0.1235, boardWarningRound4(-0.12345), 0.0)
  }

  @Test
  fun round4StripsFloatNoise() {
    assertEquals(0.12, boardWarningRound4(3.92 - 3.80), 0.0)
    assertEquals(-0.12, boardWarningRound4(3.80 - 3.92), 0.0)
  }
}
