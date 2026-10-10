import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinator.kt `VescFaultCaptureSample`
/// @parity /modules/vescape-core/src/index.ts `VescFaultCaptureSample`
struct VescFaultCaptureSample {
  let capturedAtMs: Int64
  let speed, dutyCycle, erpm, batteryVoltage, batteryCurrent, motorCurrent: Double?
  let tempMosfet, tempMotor, pitch, roll, balancePitch, adc1, adc2: Double?
  let state: Int?

  func toMap() -> [String: Any?] {
    ["capturedAtMs": capturedAtMs, "speed": speed, "dutyCycle": dutyCycle, "erpm": erpm,
     "batteryVoltage": batteryVoltage, "batteryCurrent": batteryCurrent, "motorCurrent": motorCurrent,
     "tempMosfet": tempMosfet, "tempMotor": tempMotor, "pitch": pitch, "roll": roll,
     "balancePitch": balancePitch, "adc1": adc1, "adc2": adc2, "state": state]
  }

  static func fromLiveSample(_ map: [String: Any?]) -> VescFaultCaptureSample? {
    func num(_ key: String) -> Double? {
      guard let raw = map[key] ?? nil else { return nil }
      if let d = raw as? Double { return d }
      if let i = raw as? Int { return Double(i) }
      if let i = raw as? Int64 { return Double(i) }
      if let n = raw as? NSNumber { return n.doubleValue }
      return nil
    }
    guard let capturedAt = num("lastPacketAt").map({ Int64($0) }) else { return nil }
    return .init(capturedAtMs: capturedAt, speed: num("speed"), dutyCycle: num("dutyCycle"), erpm: num("erpm"), batteryVoltage: num("batteryVoltage"), batteryCurrent: num("batteryCurrent"), motorCurrent: num("motorCurrent"), tempMosfet: num("tempMosfet"), tempMotor: num("tempMotor"), pitch: num("pitch"), roll: num("roll"), balancePitch: num("balancePitch"), adc1: num("adc1"), adc2: num("adc2"), state: num("state").map { Int($0) })
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCaptureCoordinator.kt `VescFaultCapture`
/// @parity /modules/vescape-core/src/index.ts `VescFaultCapture`
struct VescFaultCapture {
  let occurrenceId: String
  let boardId: String
  let startedAtMs: Int64
  let openedAtMs: Int64
  let sampleCount: Int
  func toMap() -> [String: Any?] { ["occurrenceId": occurrenceId, "boardId": boardId, "startedAtMs": startedAtMs, "openedAtMs": openedAtMs, "sampleCount": sampleCount] }
}

protocol VescFaultCaptureStoring {
  func saveCapture(_ capture: VescFaultCapture, samples: [VescFaultCaptureSample]) throws
  func getCapture(_ occurrenceId: String) throws -> VescFaultCapture?
  func getSamples(_ occurrenceId: String) throws -> [VescFaultCaptureSample]
}
