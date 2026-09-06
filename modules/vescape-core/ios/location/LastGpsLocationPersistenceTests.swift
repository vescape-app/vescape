import GRDB
import XCTest
@testable import VescapeCore

final class LastGpsLocationPersistenceTests: XCTestCase {
  func testPreciseWritesAreThrottledAndSurviveRepositoryRecreation() throws {
    let db = try DatabaseQueue()
    try db.write { db in
      try db.execute(sql: "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL)")
    }
    let repository = AppDataRepository.forTesting(dbWriter: db)
    let queue = DispatchQueue(label: "last-gps-test")
    var now: Int64 = 100_000
    let persistence = LastGpsLocationPersistence(appData: repository, queue: queue, nowMs: { now })
    func fix(_ latitude: Double, precise: Bool = true) {
      persistence.onLocationUpdated(TelemetryLocationCapture(
        latitude: latitude, longitude: -latitude, speedMps: nil, bearingDeg: nil,
        accuracyM: precise ? 5 : 100, altitudeM: nil, timestamp: 1, precise: precise
      ))
      queue.sync {}
    }
    func assertStored(_ latitude: Double, file: StaticString = #filePath, line: UInt = #line) {
      // A fresh repository uses the same casts as the cold-start Navigation/Legal Policy readers.
      let settings = AppDataRepository.forTesting(dbWriter: db).getSettings()
      XCTAssertEqual(settings["lastGpsLatitude"] as? Double, latitude, file: file, line: line)
      XCTAssertEqual(settings["lastGpsLongitude"] as? Double, -latitude, file: file, line: line)
    }

    fix(50, precise: false)
    XCTAssertNil(repository.getSettings()["lastGpsLatitude"] as? Double)
    fix(51)
    assertStored(51)
    now += 29_999
    fix(52)
    assertStored(51)
    now += 1
    fix(53, precise: false)
    assertStored(51)
    fix(54)
    assertStored(54)
    now += 30_000
    fix(55)
    assertStored(55)
  }
}
