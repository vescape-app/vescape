import XCTest

@testable import VescapeCore

final class SessionResumeStoreTests: XCTestCase {
  private var defaults: UserDefaults!
  private var suiteName: String!

  override func setUp() {
    super.setUp()
    suiteName = "vescape.tests.resume.\(UUID().uuidString)"
    defaults = UserDefaults(suiteName: suiteName)
  }

  override func tearDown() {
    defaults.removePersistentDomain(forName: suiteName)
    defaults = nil
    super.tearDown()
  }

  func testNoMarkerByDefault() {
    XCTAssertNil(SessionResumeStore(defaults: defaults).pending)
  }

  func testSaveRoundTrips() {
    let store = SessionResumeStore(defaults: defaults)
    store.save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: true, nowMs: 1234)
    XCTAssertEqual(
      store.pending,
      SessionResumeMarker(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: true, savedAtMs: 1234)
    )
  }

  /// The marker outlives the process, so a second store instance (the next launch) must read it.
  func testMarkerSurvivesANewStoreInstance() {
    SessionResumeStore(defaults: defaults)
      .save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: false, nowMs: 1)
    XCTAssertEqual(SessionResumeStore(defaults: defaults).pending?.appBoardId, "board-1")
  }

  func testRecordingFlagIsRefreshedInPlace() {
    let store = SessionResumeStore(defaults: defaults)
    store.save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: false, nowMs: 7)
    store.setRecordingActive(true)
    XCTAssertEqual(store.pending?.recordingActive, true)
    XCTAssertEqual(store.pending?.appBoardId, "board-1")
    XCTAssertEqual(store.pending?.savedAtMs, 7)
  }

  /// Recording can be toggled with no session on: that must not conjure a marker.
  func testRecordingFlagWithoutMarkerIsANoop() {
    let store = SessionResumeStore(defaults: defaults)
    store.setRecordingActive(true)
    XCTAssertNil(store.pending)
  }

  func testClearDropsTheMarker() {
    let store = SessionResumeStore(defaults: defaults)
    store.save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: true, nowMs: 1)
    store.clear()
    XCTAssertNil(store.pending)
  }

  /// A half-written marker must not eagerly spin up BLE for a board that cannot be resolved.
  func testMarkerWithoutBleIdIsIgnored() {
    defaults.set(["appBoardId": "board-1", "recordingActive": true], forKey: "vescape.session.resume")
    XCTAssertNil(SessionResumeStore(defaults: defaults).pending)
  }
}
