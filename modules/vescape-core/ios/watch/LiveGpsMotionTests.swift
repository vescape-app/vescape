import XCTest
@testable import VescapeCore

/// @parity /src/modules/map/lib/liveMotion/parity.test.ts
/// @parity /watch/wearos/src/test/java/app/vescape/wear/LiveGpsMotionTest.kt
final class LiveGpsMotionTests: XCTestCase {
  func testSharedBehaviorFixtures() throws {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { root.deleteLastPathComponent() }
    let data = try Data(contentsOf: root.appendingPathComponent("shared/fixtures/live-map-motion.json"))
    let scenarios = (try JSONSerialization.jsonObject(with: data) as! [String: Any])["scenarios"] as! [[String: Any]]
    for scenario in scenarios {
      let m = LiveGpsMotion(); var source = 1.0
      for e in scenario["events"] as! [[String: Any]] {
        let at = (e["now"] as! NSNumber).doubleValue
        func number(_ key: String, _ fallback: Double = 0) -> Double { (e[key] as? NSNumber)?.doubleValue ?? fallback }
        let label = "\(scenario["name"]!) at \(at)"
        switch e["op"] as! String {
        case "reset": source = number("source"); m.reset(source: source, now: at)
        case "fix": XCTAssertEqual(m.accept(MotionFix(longitude: number("eastM") / 111320, latitude: number("northM") / 110574, timestamp: number("timestamp", at), accuracyM: number("accuracyM", 3)), receivedAt: at, ageMs: number("ageMs"), source: number("source", source)), e["accepted"] as? Bool ?? true, label)
        case "speed": XCTAssertEqual(m.updateSpeed(number("mps"), revision: at, receivedAt: at, source: number("source", source)), e["accepted"] as? Bool ?? true, label)
        case "config": m.configure(MotionConfig.fromJson(String(data: try JSONSerialization.data(withJSONObject: e), encoding: .utf8)!), now: at)
        case "sample":
          let position = try XCTUnwrap(m.position(at))
          if e["eastM"] != nil { XCTAssertEqual(position.longitude * 111320, number("eastM"), accuracy: 0.0001, label) }
          if e["northM"] != nil { XCTAssertEqual(position.latitude * 110574, number("northM"), accuracy: 0.0001, label) }
          if e["heading"] is NSNull { XCTAssertNil(m.pointHeading(at), label) }
          else if e["heading"] != nil { XCTAssertEqual(try XCTUnwrap(m.pointHeading(at)), number("heading"), accuracy: 0.0001, label) }
          if e["cameraHeading"] is NSNull { XCTAssertNil(m.cameraHeading(at), label) }
          else if e["cameraHeading"] != nil { XCTAssertEqual(try XCTUnwrap(m.cameraHeading(at)), number("cameraHeading"), accuracy: 0.0001, label) }
          if e["cadenceMs"] != nil { XCTAssertEqual(m.cadenceMs, number("cadenceMs"), accuracy: 0.0001, label) }
          if e["prediction"] != nil { XCTAssertEqual(m.effectivePrediction(at), number("prediction"), accuracy: 0.0001, label) }
          if let recovering = e["recovering"] as? Bool { XCTAssertEqual(m.recovering, recovering, label) }
        default: XCTFail("Unknown fixture event")
        }
      }
    }
  }
}
