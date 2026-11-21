import XCTest

@testable import VescapeCore

final class PrivacyZoneFilterTests: XCTestCase {
  private func zone(
    lat: Double,
    lon: Double,
    radiusMeters: Int,
    enabled: Bool = true,
    id: String = "z1"
  ) -> PrivacyZoneEntity {
    PrivacyZoneEntity(
      id: id,
      enabled: enabled,
      centerLatitudeE7: Int((lat * 1e7).rounded()),
      centerLongitudeE7: Int((lon * 1e7).rounded()),
      radiusMeters: radiusMeters
    )
  }

  private func e7(_ deg: Double) -> Int { Int((deg * 1e7).rounded()) }

  func testPointInsideZoneReturnsTrue() {
    let z = zone(lat: 52.2297, lon: 21.0122, radiusMeters: 500)
    XCTAssertTrue(isInsidePrivacyZone(latitudeE7: e7(52.2297), longitudeE7: e7(21.0122), zone: z))
  }

  func testPointOnEdgeReturnsTrue() {
    let z = zone(lat: 52.0, lon: 21.0, radiusMeters: 1000)
    let offsetLat = 52.0 + (999.0 / 111_319.0)
    XCTAssertTrue(isInsidePrivacyZone(latitudeE7: e7(offsetLat), longitudeE7: e7(21.0), zone: z))
  }

  func testPointOutsideZoneReturnsFalse() {
    let z = zone(lat: 52.0, lon: 21.0, radiusMeters: 100)
    let farLat = 52.01
    XCTAssertFalse(isInsidePrivacyZone(latitudeE7: e7(farLat), longitudeE7: e7(21.0), zone: z))
  }

  func testAnyMatchReturnsTrueForOverlappingZones() {
    let zones = [
      zone(lat: 52.0, lon: 21.0, radiusMeters: 100, id: "z1"),
      zone(lat: 52.001, lon: 21.0, radiusMeters: 200, id: "z2"),
    ]
    XCTAssertTrue(isInsideAnyPrivacyZone(latitudeE7: e7(52.001), longitudeE7: e7(21.0), zones: zones))
  }

  func testNoZonesReturnsFalse() {
    XCTAssertFalse(isInsideAnyPrivacyZone(latitudeE7: e7(52.0), longitudeE7: e7(21.0), zones: []))
  }

  func testPointInsideFirstZoneButNotSecond() {
    let zones = [
      zone(lat: 52.0, lon: 21.0, radiusMeters: 500, id: "z1"),
      zone(lat: 53.0, lon: 22.0, radiusMeters: 500, id: "z2"),
    ]
    XCTAssertTrue(isInsideAnyPrivacyZone(latitudeE7: e7(52.0), longitudeE7: e7(21.0), zones: zones))
    XCTAssertFalse(isInsideAnyPrivacyZone(latitudeE7: e7(51.0), longitudeE7: e7(20.0), zones: zones))
  }

  func testSmallRadiusZoneRejectsNearbyPoint() {
    let z = zone(lat: 52.0, lon: 21.0, radiusMeters: 50)
    let offsetLat = 52.0 + (100.0 / 111_319.0)
    XCTAssertFalse(isInsidePrivacyZone(latitudeE7: e7(offsetLat), longitudeE7: e7(21.0), zone: z))
  }

  func testLongitudeOffsetAccountsForCosine() {
    let z = zone(lat: 60.0, lon: 25.0, radiusMeters: 500)
    let lonOffset = 500.0 / (111_319.0 * cos(60.0 * .pi / 180.0))
    XCTAssertTrue(isInsidePrivacyZone(latitudeE7: e7(60.0), longitudeE7: e7(25.0 + lonOffset * 0.99), zone: z))
    XCTAssertFalse(isInsidePrivacyZone(latitudeE7: e7(60.0), longitudeE7: e7(25.0 + lonOffset * 1.5), zone: z))
  }
}
