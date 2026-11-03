import XCTest
@testable import VescapeCore

/// Service Config resolution: persisted answer over the baked seed, failures keep what is known, and a
/// successful answer replaces the config whole.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/serviceconfig/ServiceConfigCoordinatorTest.kt
final class ServiceConfigTests: XCTestCase {
  private final class RecordingTransport {
    var urls: [String] = []
    private var pending: [(Data?) -> Void] = []

    lazy var transport: AppStatusTransport = { [unowned self] url, _, _, onResult in
      self.urls.append(url)
      self.pending.append(onResult)
    }

    func resolveAll(_ body: String?) {
      let callbacks = pending
      pending.removeAll()
      for callback in callbacks { callback(body.map { Data($0.utf8) }) }
    }
  }

  private final class MemoryPersistence: ServiceConfigPersistence {
    var body: Data?
    init(_ body: String? = nil) { self.body = body.map { Data($0.utf8) } }
    func read() -> Data? { body }
    func write(_ body: Data) { self.body = body }
  }

  private let seed = ServiceConfig(mapboxToken: "pk.seed", mapyToken: "mapy-seed")

  private func coordinator(_ transport: RecordingTransport, _ persistence: MemoryPersistence) -> ServiceConfigCoordinator {
    ServiceConfigCoordinator(
      installedVersion: "0.90.0",
      baseUrl: "https://api.vescape.app",
      transport: transport.transport,
      persistence: persistence,
      seed: seed
    )
  }

  func testStartsFromTheBakedSeedWhenNothingIsPersisted() {
    XCTAssertEqual(coordinator(RecordingTransport(), MemoryPersistence()).current, seed)
  }

  func testAPersistedAnswerWinsOverTheSeedIncludingAServiceItLeavesOut() {
    let current = coordinator(RecordingTransport(), MemoryPersistence(#"{"tokens":{"mapbox":"pk.server"}}"#)).current

    XCTAssertEqual(current, ServiceConfig(mapboxToken: "pk.server", mapyToken: nil))
  }

  func testASuccessfulRefreshPersistsReplacesAndNotifiesOnce() {
    let transport = RecordingTransport()
    let persistence = MemoryPersistence()
    let subject = coordinator(transport, persistence)
    var seen: [ServiceConfig] = []
    _ = subject.addChangeListener { seen.append($0) }

    subject.refresh()
    subject.refresh()
    transport.resolveAll(#"{"tokens":{"mapbox":"pk.server","mapy":"mapy-server"}}"#)

    let expected = ServiceConfig(mapboxToken: "pk.server", mapyToken: "mapy-server")
    XCTAssertEqual(transport.urls, ["https://api.vescape.app/api/service-config"])
    XCTAssertEqual(seen, [expected])
    XCTAssertEqual(coordinator(transport, persistence).current, expected)
  }

  func testAFailedOrMalformedRefreshKeepsTheKnownConfig() {
    let transport = RecordingTransport()
    let persistence = MemoryPersistence()
    let subject = coordinator(transport, persistence)

    subject.refresh()
    transport.resolveAll(nil)
    subject.refresh()
    transport.resolveAll(#"{"error":"rate-limited"}"#)

    XCTAssertEqual(subject.current, seed)
    XCTAssertNil(persistence.body)
  }
}
