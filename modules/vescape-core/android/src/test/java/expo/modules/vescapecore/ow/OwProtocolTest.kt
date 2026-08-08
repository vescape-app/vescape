package expo.modules.vescapecore.ow

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class OwProtocolTest {
  private fun spec(shortId: Int) = OW_CHARACTERISTICS.first { it.shortId == shortId }

  @Test
  fun buildsUnlockResponseForFirmware4140AndBelow() {
    // "CRX" prefix + 16 challenge bytes + 1 padding byte, per the OWCE/ponewheel handshake.
    val challenge = byteArrayOf(
      0x43, 0x52, 0x58,
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      0,
    )
    // Expected digest vector: MD5(challenge[3..18] || salt), XOR checksum over bytes 0-18.
    val expected = byteArrayOf(
      0x43, 0x52, 0x58,
      0xe7.toByte(), 0x20, 0x5e, 0xc7.toByte(), 0xe5.toByte(), 0xf1.toByte(), 0xb7.toByte(), 0x70,
      0xca.toByte(), 0x75, 0x4b, 0x38, 0xc4.toByte(), 0x55, 0xaa.toByte(), 0x25,
      0x16,
    )
    assertArrayEquals(expected, owBuildUnlockResponse(challenge))
  }

  @Test
  fun rejectsShortUnlockChallenge() {
    val error = kotlin.runCatching { owBuildUnlockResponse(ByteArray(19)) }.exceptionOrNull()
    assertTrue(error is IllegalArgumentException)
  }

  @Test
  fun localUnlockOnlyCoversFirmwareThrough4140() {
    assertTrue(owCanUnlockLocally(4140))
    assertTrue(owCanUnlockLocally(4000))
    assertFalse(owCanUnlockLocally(4141))
    assertFalse(owCanUnlockLocally(4155))
    assertFalse(owCanUnlockLocally(null))
  }

  @Test
  fun lockedBoardReportsRidingModeZero() {
    assertFalse(owIsUnlocked(0))
    assertFalse(owIsUnlocked(null))
    assertTrue(owIsUnlocked(1))
  }

  @Test
  fun convertsRpmToSpeedWithThe35InchTire() {
    assertEquals(0.0, owSpeedKmh(0), 0.001)
    // mph = 60 * 35 * rpm / 63360; 1000 rpm ≈ 33.145 mph ≈ 53.34 km/h.
    assertEquals(53.34, owSpeedKmh(1000), 0.01)
  }

  @Test
  fun parsesBatteryPercentFromTheLowByte() {
    assertEquals("63 %", spec(OW_CHAR_BATTERY).parse(byteArrayOf(0, 63), null).display)
    assertEquals("100 %", spec(OW_CHAR_BATTERY).parse(byteArrayOf(0, 100), null).display)
  }

  @Test
  fun parsesPackedControllerAndMotorTemps() {
    assertEquals(
      "controller 30 °C · motor 35 °C",
      spec(0xf310).parse(byteArrayOf(30, 35), null).display,
    )
  }

  @Test
  fun parsesBatteryVoltageAsTenths() {
    assertEquals("58.1 V", spec(0xf316).parse(byteArrayOf(0x02, 0x45), null).display)
  }

  @Test
  fun parsesBatteryCurrentAsSignedAmps() {
    assertEquals("3.00 A", spec(0xf312).parse(byteArrayOf(0x05, 0xDC.toByte()), null).display)
    // Two's complement -1500: regen shows negative.
    assertEquals("-3.00 A", spec(0xf312).parse(byteArrayOf(0xFA.toByte(), 0x24), null).display)
  }

  @Test
  fun parsesCellPacketsForNewFirmware() {
    // Firmware >= 4141: one uint16, cell id in the high nibble, volts = low 12 bits * 0.0011.
    val raw = byteArrayOf(0x33, 0xE8.toByte()) // cell 3, 1000 * 0.0011 = 1.10 V
    assertEquals("cell 3 1.10 V", spec(0xf31b).parse(raw, 4141).display)
  }

  @Test
  fun parsesAnglesAroundLevel() {
    // Level is ~1800 raw; 0.1 degree per unit.
    assertEquals("0.0 °", spec(0xf307).parse(byteArrayOf(0x07, 0x08), null).display)
  }

  @Test
  fun resolvesSpecsByUuidAndRejectsForeignUuids() {
    assertEquals("Battery", owSpecFor(owCharUuid(OW_CHAR_BATTERY))?.name)
    assertEquals(OW_CHAR_BATTERY, owShortId(owCharUuid(OW_CHAR_BATTERY)))
    assertNull(owSpecFor(UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")))
    assertNull(owShortId(UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")))
  }
}
