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
    store.save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: true)
    XCTAssertEqual(
      store.pending,
      SessionResumeMarker(
        appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: true)
    )
  }

  func testMarkerSurvivesANewStoreInstance() {
    SessionResumeStore(defaults: defaults)
      .save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: false)
    XCTAssertEqual(SessionResumeStore(defaults: defaults).pending?.appBoardId, "board-1")
  }

  func testRecordingIsRefreshedInPlace() {
    let store = SessionResumeStore(defaults: defaults)
    store.save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: false)
    store.setRecording(active: true)
    XCTAssertEqual(store.pending?.recordingActive, true)
    XCTAssertEqual(store.pending?.appBoardId, "board-1")
    store.setRecording(active: false)
    XCTAssertEqual(store.pending?.recordingActive, false)
  }

  func testRecordingFlagWithoutMarkerIsANoop() {
    let store = SessionResumeStore(defaults: defaults)
    store.setRecording(active: true)
    XCTAssertNil(store.pending)
  }

  func testClearDropsTheMarker() {
    let store = SessionResumeStore(defaults: defaults)
    store.save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: true)
    store.clear()
    XCTAssertNil(store.pending)
  }

  func testMarkerWithoutBleIdIsIgnored() {
    defaults.set(["appBoardId": "board-1", "recordingActive": true], forKey: "vescape.session.resume")
    XCTAssertNil(SessionResumeStore(defaults: defaults).pending)
  }
}
