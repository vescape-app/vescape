package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import expo.modules.vescapecore.database.PrivacyZoneEntity

class PrivacyZoneFilterTest {

  private fun zone(
    lat: Double,
    lon: Double,
    radiusMeters: Int,
    enabled: Boolean = true,
    id: String = "z1",
    preset: String = "custom",
  ) = PrivacyZoneEntity(
    id = id,
    preset = preset,
    name = "Test",
    enabled = enabled,
    centerLatitudeE7 = (lat * 1e7).toInt(),
    centerLongitudeE7 = (lon * 1e7).toInt(),
    radiusMeters = radiusMeters,
    createdAt = 0L,
    updatedAt = 0L,
  )

  private fun e7(deg: Double) = (deg * 1e7).toInt()

  @Test
  fun pointInsideZoneReturnsTrue() {
    val z = zone(52.2297, 21.0122, 500)
    assertTrue(isInsidePrivacyZone(e7(52.2297), e7(21.0122), z))
  }

  @Test
  fun pointOnEdgeReturnsTrue() {
    val z = zone(52.0, 21.0, 1000)
    val offsetLat = 52.0 + (1000.0 / 111_319.0)
    assertTrue(isInsidePrivacyZone(e7(offsetLat), e7(21.0), z))
  }

  @Test
  fun pointOutsideZoneReturnsFalse() {
    val z = zone(52.0, 21.0, 100)
    val farLat = 52.01
    assertFalse(isInsidePrivacyZone(e7(farLat), e7(21.0), z))
  }

  @Test
  fun anyMatchReturnsTrueForOverlappingZones() {
    val zones = listOf(
      zone(52.0, 21.0, 100, id = "z1"),
      zone(52.001, 21.0, 200, id = "z2"),
    )
    assertTrue(isInsideAnyPrivacyZone(e7(52.001), e7(21.0), zones))
  }

  @Test
  fun noZonesReturnsFalse() {
    assertFalse(isInsideAnyPrivacyZone(e7(52.0), e7(21.0), emptyList()))
  }

  @Test
  fun pointInsideFirstZoneButNotSecond() {
    val zones = listOf(
      zone(52.0, 21.0, 500, id = "z1"),
      zone(53.0, 22.0, 500, id = "z2"),
    )
    assertTrue(isInsideAnyPrivacyZone(e7(52.0), e7(21.0), zones))
    assertFalse(isInsideAnyPrivacyZone(e7(51.0), e7(20.0), zones))
  }

  @Test
  fun smallRadiusZoneRejectsNearbyPoint() {
    val z = zone(52.0, 21.0, 50)
    val offsetLat = 52.0 + (100.0 / 111_319.0)
    assertFalse(isInsidePrivacyZone(e7(offsetLat), e7(21.0), z))
  }

  @Test
  fun longitudeOffsetAccountsForCosine() {
    val z = zone(60.0, 25.0, 500)
    val lonOffset = 500.0 / (111_319.0 * kotlin.math.cos(Math.toRadians(60.0)))
    assertTrue(isInsidePrivacyZone(e7(60.0), e7(25.0 + lonOffset * 0.99), z))
    assertFalse(isInsidePrivacyZone(e7(60.0), e7(25.0 + lonOffset * 1.5), z))
  }
}
