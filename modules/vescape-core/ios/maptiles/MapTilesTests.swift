import XCTest
@testable import VescapeCore

/// Counts fetches and holds them until released, so a test can line up concurrent requests.
private actor FetchGate {
  private(set) var fetches = 0
  private var waiting: [CheckedContinuation<Void, Never>] = []
  private var released = false
  private let failFirst: Bool

  init(failFirst: Bool = false, released: Bool = false) {
    self.failFirst = failFirst
    self.released = released
  }

  func fetch() async -> Data? {
    fetches += 1
    if !released { await withCheckedContinuation { waiting.append($0) } }
    return failFirst && fetches == 1 ? nil : Data([1, 2, 3])
  }

  func release() {
    released = true
    waiting.forEach { $0.resume() }
    waiting = []
  }
}

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/maptiles/MapTilesTest.kt
final class MapTilesTests: XCTestCase {
  private var directory: URL!

  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: directory)
  }

  private func tiles(_ gate: FetchGate) -> MapTiles {
    MapTiles(directory: directory, fetch: { _ in await gate.fetch() }, accessToken: "pk.test")
  }

  func testConcurrentRequestsForOneTileShareADownloadAndLaterOnesReadTheDisk() async throws {
    let gate = FetchGate()
    let tiles = tiles(gate)

    async let first = tiles.tile(z: 15, x: 17934, y: 10954)
    async let second = tiles.tile(z: 15, x: 17934, y: 10954)
    while await gate.fetches == 0 { await Task.yield() }
    await gate.release()

    let downloaded = await first
    let shared = await second
    let file = try XCTUnwrap(downloaded)
    XCTAssertEqual(file, shared)
    XCTAssertEqual(try Data(contentsOf: file), Data([1, 2, 3]))
    let cached = await tiles.tile(z: 15, x: 17934, y: 10954)
    XCTAssertEqual(cached, file)
    let fetches = await gate.fetches
    XCTAssertEqual(fetches, 1)
  }

  func testAFailedDownloadStoresNothingAndTheNextRequestRetries() async throws {
    let gate = FetchGate(failFirst: true, released: true)
    let tiles = tiles(gate)

    let failed = await tiles.tile(z: 3, x: 4, y: 2)
    XCTAssertNil(failed)
    let stored = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.isRegularFileKey])?
      .compactMap { $0 as? URL }
      .filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true } ?? []
    XCTAssertEqual(stored, [])
    let retry = await tiles.tile(z: 3, x: 4, y: 2)
    let retried = try XCTUnwrap(retry)
    XCTAssertEqual(try Data(contentsOf: retried), Data([1, 2, 3]))
    let fetches = await gate.fetches
    XCTAssertEqual(fetches, 2)
  }

  func testTilesOutsideTheZoomsGridNeverReachTheNetwork() async {
    let gate = FetchGate(released: true)
    let tiles = tiles(gate)

    let wide = await tiles.tile(z: 2, x: 4, y: 0)
    let negative = await tiles.tile(z: 2, x: 0, y: -1)
    let zoom = await tiles.tile(z: -1, x: 0, y: 0)
    XCTAssertNil(wide)
    XCTAssertNil(negative)
    XCTAssertNil(zoom)
    let fetches = await gate.fetches
    XCTAssertEqual(fetches, 0)
  }
}
