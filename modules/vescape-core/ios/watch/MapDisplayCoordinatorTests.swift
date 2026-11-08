import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/display/MapDisplayCoordinatorTest.kt
final class MapDisplayCoordinatorTests: XCTestCase {
  func testSharedInputLifecycleFixtures() throws {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { root.deleteLastPathComponent() }
    let data = try Data(contentsOf: root.appendingPathComponent("shared/fixtures/map-display-coordinator.json"))
    let scenarios = (try JSONSerialization.jsonObject(with: data) as! [String: Any])["scenarios"] as! [[String: Any]]
    for scenario in scenarios {
      var local = 0.0
      var emissions = 0
      struct Task { let id: UUID; let at: Double; let action: () -> Void }
      var tasks: [Task] = []
      let owner = MapDisplayCoordinator(clock: { local }, schedule: { delay, action in
        let id = UUID()
        tasks.append(Task(id: id, at: local + delay, action: action))
        return { tasks.removeAll { $0.id == id } }
      }, emit: { _ in emissions += 1 })
      for (index, event) in (scenario["events"] as! [[String: Any]]).enumerated() {
        let label = "\(scenario["name"]!) event \(index)"
        let body = event["body"] as? [String: Any] ?? [:]
        switch event["op"] as! String {
        case "options": owner.options(body)
        case "input": owner.input(event["name"] as! String, body)
        case "advance":
          let until = (event["now"] as! NSNumber).doubleValue
          var count = 0
          while let task = tasks.filter({ $0.at <= until }).min(by: { $0.at < $1.at }) {
            count += 1
            guard count < 1000 else { XCTFail("\(label) runaway timer"); break }
            tasks.removeAll { $0.id == task.id }
            local = task.at
            task.action()
          }
          local = until
        case "check":
          let snapshot = owner.snapshot()
          for (key, wanted) in event["expect"] as! [String: Any] {
            let actual: Any?
            switch key {
            case "emissions": actual = emissions
            case "pending": actual = tasks.count
            case "segmentsCount": actual = (snapshot["segments"] as! [[String: Any]]).count
            case "trailCount", "minTrail": actual = (snapshot["trail"] as! [[Double]]).count
            default: actual = key.split(separator: ".").reduce(snapshot as Any?) { ($0 as? [String: Any])?[String($1)] }
            }
            if key == "minTrail" { XCTAssertGreaterThanOrEqual(actual as! Int, (wanted as! NSNumber).intValue, label) }
            else if let actual = actual as? NSNumber, let wanted = wanted as? NSNumber {
              XCTAssertEqual(actual.doubleValue, wanted.doubleValue, accuracy: 0.0001, "\(label) \(key)")
            } else if wanted is NSNull { XCTAssertTrue(actual == nil || actual is NSNull, "\(label) \(key)") }
            else { XCTAssertEqual(actual as? String, wanted as? String, "\(label) \(key)") }
          }
        default: XCTFail("\(label) unknown operation")
        }
      }
      owner.stop()
      XCTAssertTrue(tasks.isEmpty)
    }
  }
}
