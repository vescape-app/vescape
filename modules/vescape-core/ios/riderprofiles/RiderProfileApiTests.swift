import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/riderprofiles/RiderProfileApiTest.kt
final class RiderProfileApiTests: XCTestCase {
  private let profile = #"{"accountId":"rider","nick":"Ada","nationality":null}"#
  private let stats = #"{"distanceM":null,"rideCount":3,"rideTimeMs":120000,"topSpeedKmh":28,"avgSpeedKmh":17,"longestRideM":null,"batteryUsedWh":42,"batteryRegenWh":null}"#

  private struct Transport: ApiTransport {
    let body: String
    let status: Int
    let inspect: (ApiRequest) -> Void
    func execute(_ request: ApiRequest) async throws -> ApiResponse {
      inspect(request)
      return ApiResponse(status: status, body: body)
    }
  }

  private func api(_ body: String, status: Int = 200, inspect: @escaping (ApiRequest) -> Void = { _ in }) -> RiderProfileApi {
    RiderProfileApi(api: VescapeApi(
      baseUrl: "https://api.vescape.app",
      appVersion: "1",
      credentialProvider: { DeviceCredential(serverUrl: "https://api.vescape.app", token: "token", accountId: "viewer", expiresAt: nil) },
      transport: Transport(body: body, status: status, inspect: inspect)
    ))
  }

  func testDetailKeepsTotalsMonthsAndNullableMetricsWhileSearchStaysAProfile() async throws {
    let month = stats.dropLast() + #", "month":"2026-01"}"#
    let detail = try await api(profile.dropLast() + #", "stats":{"total":\#(stats),"months":[\#(month)]}}"#).rider("rider")!
    XCTAssertEqual(detail["nick"] as? String, "Ada")
    let detailStats = detail["stats"] as! [String: Any]
    let total = detailStats["total"] as! [String: Any?]
    XCTAssertEqual(total["rideCount"] as? Int, 3)
    XCTAssertEqual(total["batteryUsedWh"] as? Double, 42)
    XCTAssertNil(total["distanceM"] ?? nil)
    let months = detailStats["months"] as! [[String: Any?]]
    XCTAssertEqual(months.first?["month"] as? String, "2026-01")
    let found = try await api(#"{"items":[\#(profile)]}"#).search(nick: "Ada").first!
    XCTAssertFalse(found.keys.contains("stats"))
  }

  func testMissingRiderAndAbsentStatsTotalsStayNullable() async throws {
    let missing = try await api("", status: 404).rider("rider")
    XCTAssertNil(missing)
    let detail = try await api(profile.dropLast() + #", "stats":{"total":null,"months":[]}}"#).rider("rider")!
    let detailStats = detail["stats"] as! [String: Any]
    XCTAssertTrue(detailStats["total"] is NSNull)
    XCTAssertEqual((detailStats["months"] as! [[String: Any?]]).count, 0)
  }

  func testFriendRidesPagesSendLimitAndCursor() async throws {
    let cursor = "2026-01-01T00:00:00Z"
    let first = try await api(#"{"rides":[{"startedAt":"\#(cursor)","endedAt":"2026-01-01T00:01:00Z"}],"nextBefore":"\#(cursor)"}"#) {
      XCTAssertEqual($0.url, "https://api.vescape.app/api/friends/rider/rides?limit=5")
    }.friendRides("rider", limit: 5)
    XCTAssertEqual((first["rides"] as? [[String: Any?]])?.first?["startedAt"] as? String, cursor)
    XCTAssertEqual(first["nextBefore"] as? String, cursor)

    let last = try await api(#"{"rides":[],"nextBefore":null}"#) {
      let url = URLComponents(string: $0.url)
      XCTAssertEqual(url?.queryItems?.first(where: { $0.name == "before" })?.value, cursor)
    }.friendRides("rider", limit: 5, before: first["nextBefore"] as? String)
    XCTAssertTrue(last["nextBefore"] is NSNull)
  }
}
