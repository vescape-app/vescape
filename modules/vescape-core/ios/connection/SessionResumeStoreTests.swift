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
    store.save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: true, recordingId: "rec-1")
    XCTAssertEqual(
      store.pending,
      SessionResumeMarker(
        appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: true, recordingId: "rec-1")
    )
  }

  /// The marker outlives the process, so a second store instance (the next launch) must read it.
  func testMarkerSurvivesANewStoreInstance() {
    SessionResumeStore(defaults: defaults)
      .save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: false, recordingId: nil)
    XCTAssertEqual(SessionResumeStore(defaults: defaults).pending?.appBoardId, "board-1")
  }

  /// The recording flag *and* the identity it names are refreshed in place: the recording is minted
  /// after the session begins, so the marker written at begin does not know its id yet.
  func testRecordingIsRefreshedInPlace() {
    let store = SessionResumeStore(defaults: defaults)
    store.save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: false, recordingId: nil)
    store.setRecording(active: true, recordingId: "rec-1")
    XCTAssertEqual(store.pending?.recordingActive, true)
    XCTAssertEqual(store.pending?.recordingId, "rec-1")
    XCTAssertEqual(store.pending?.appBoardId, "board-1")
  }

  /// Stopping recording drops the identity too: a marker still naming an ended recording would ask
  /// the next launch to rejoin a ride the rider finished.
  func testStoppingRecordingClearsTheIdentity() {
    let store = SessionResumeStore(defaults: defaults)
    store.save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: true, recordingId: "rec-1")
    store.setRecording(active: false, recordingId: nil)
    XCTAssertEqual(store.pending?.recordingActive, false)
    XCTAssertNil(store.pending?.recordingId)
  }

  /// Recording can be toggled with no session on: that must not conjure a marker.
  func testRecordingFlagWithoutMarkerIsANoop() {
    let store = SessionResumeStore(defaults: defaults)
    store.setRecording(active: true, recordingId: "rec-1")
    XCTAssertNil(store.pending)
  }

  func testClearDropsTheMarker() {
    let store = SessionResumeStore(defaults: defaults)
    store.save(appBoardId: "board-1", bleId: "BLE-UUID", recordingActive: true, recordingId: "rec-1")
    store.clear()
    XCTAssertNil(store.pending)
  }

  /// A half-written marker must not eagerly spin up BLE for a board that cannot be resolved.
  func testMarkerWithoutBleIdIsIgnored() {
    defaults.set(["appBoardId": "board-1", "recordingActive": true], forKey: "vescape.session.resume")
    XCTAssertNil(SessionResumeStore(defaults: defaults).pending)
  }
}
