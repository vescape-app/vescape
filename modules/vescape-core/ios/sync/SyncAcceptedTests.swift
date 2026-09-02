import XCTest
@testable import VescapeCore

/// The `200` body is the last thing standing between an accepted batch and a cursor that can never
/// be walked back, so it is validated exactly rather than trusted.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/sync/SyncAcceptedTest.kt
final class SyncAcceptedTests: XCTestCase {
  private func body(
    _ counts: [SyncTable: Int] = [:],
    tables: [SyncTable] = SyncTable.allCases
  ) -> String {
    let pairs = tables.map { "\"\($0.wire)\":\(counts[$0] ?? 0)" }.joined(separator: ",")
    return "{\"accepted\":{\(pairs)}}"
  }

  func testEveryTableAccountedForParses() {
    let parsed = SyncAccepted.parse(body([.boards: 3]))
    XCTAssertEqual(parsed?[.boards], 3)
    XCTAssertEqual(parsed?[.favorites], 0)
  }

  func testAMissingTableAnExtraTableOrADuplicateIsRefused() {
    XCTAssertNil(SyncAccepted.parse(body(tables: Array(SyncTable.allCases.dropFirst()))))
    XCTAssertNil(SyncAccepted.parse("{\"accepted\":{\"unknownTable\":0}}"))
    XCTAssertNil(SyncAccepted.parse("{\"accepted\":{\"boards\":1,\"boards\":1}}"))
  }

  func testAnythingThatIsNotThisResponseIsRefused() {
    XCTAssertNil(SyncAccepted.parse(""))
    XCTAssertNil(SyncAccepted.parse("{}"))
    XCTAssertNil(SyncAccepted.parse("{\"ok\":true}"))
    XCTAssertNil(SyncAccepted.parse(body() + "trailing"))
  }

  func testCountsHaveToEqualWhatWasSubmitted() throws {
    let submitted: [SyncTable: Int] = [.boards: 2]
    XCTAssertTrue(
      SyncAccepted.matches(submitted: submitted, accepted: try XCTUnwrap(SyncAccepted.parse(body(submitted))))
    )
    XCTAssertFalse(
      SyncAccepted.matches(
        submitted: submitted,
        accepted: try XCTUnwrap(SyncAccepted.parse(body([.boards: 1])))
      )
    )
    XCTAssertFalse(
      SyncAccepted.matches(
        submitted: submitted,
        accepted: try XCTUnwrap(SyncAccepted.parse(body([.boards: 2, .alerts: 1])))
      )
    )
  }
}
