import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySession.kt
enum AccessorySession {
  static let leaseMs: Int = 2_000

  static let renewIntervalMs: Int = 500

  static let requestTimeoutMs: Int = 500

  static let firstCommandRequestId = AccessoryProtocol.helloRequestId + 1

  static func resolveRateHz(requested: Double, ratesHz: [Double]) -> Double? {
    let usable = ratesHz.filter { $0.isFinite && $0 > 0 }.sorted()
    guard let first = usable.first else { return nil }
    return usable.dropFirst().reduce(first) { best, candidate in
      abs(candidate - requested) < abs(best - requested) ? candidate : best
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySession.kt `AccessoryCommand`
enum AccessoryCommand: Equatable {
  case configure(capabilityId: String, enabled: Bool, rateHz: Double)
  case state(
    capabilityId: String, telemetry: String, mode: String?, parked: String, preview: Bool)

  var capabilityId: String {
    switch self {
    case .configure(let id, _, _): return id
    case .state(let id, _, _, _, _): return id
    }
  }

  func encode(sessionId: String, requestId: Int) -> String {
    switch self {
    case .configure(let capabilityId, let enabled, let rateHz):
      return "{\"type\":\"configure\",\"sessionId\":\(quote(sessionId)),\"requestId\":\(requestId),"
        + "\"capabilityId\":\(quote(capabilityId)),\"enabled\":\(enabled),"
        + "\"rateHz\":\(number(rateHz))}"

    case .state(let capabilityId, let telemetry, let mode, let parked, let preview):
      var out = "{\"type\":\"state\",\"sessionId\":\(quote(sessionId))"
      out += ",\"requestId\":\(requestId)"
      out += ",\"capabilityId\":\(quote(capabilityId))"
      out += ",\"telemetry\":\(quote(telemetry))"
      if let mode { out += ",\"mode\":\(quote(mode))" }
      out += ",\"parked\":\(quote(parked))"
      if preview { out += ",\"preview\":true" }
      return out + "}"
    }
  }

  private func quote(_ value: String) -> String { AccessoryProtocol.quote(value) }

  private func number(_ value: Double) -> String {
    if value.isFinite, value == value.rounded(.down), abs(value) < 1e15 {
      return String(Int64(value))
    }
    return String(value)
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySession.kt `AccessoryReadingStatus`
/// @parity /modules/vescape-core/src/index.ts `AccessoryReadingStatus`
enum AccessoryReadingStatus: String {
  case ok
  case outOfRange = "out_of_range"
  case error

  static func fromWire(_ value: String?) -> AccessoryReadingStatus {
    guard let value, let known = AccessoryReadingStatus(rawValue: value) else { return .error }
    return known
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySession.kt `AccessoryReading`
/// @parity /modules/vescape-core/src/index.ts `AccessoryReadingEvent`
struct AccessoryReading: Equatable {
  let capabilityId: String
  let seq: Int
  let sampleTimeMs: Int64
  let status: AccessoryReadingStatus
  let valueCm: Double?

  init(capabilityId: String, seq: Int, sampleTimeMs: Int64, status: AccessoryReadingStatus, valueCm: Double?) {
    self.capabilityId = capabilityId
    self.seq = seq
    self.sampleTimeMs = sampleTimeMs
    self.status = status
    self.valueCm = status == .ok ? valueCm : nil
  }

  func withinDeclaredRange(rangeMin: Double?, rangeMax: Double?) -> AccessoryReading {
    guard let value = valueCm, let rangeMin, let rangeMax else { return self }
    guard value < rangeMin || value > rangeMax else { return self }
    return AccessoryReading(
      capabilityId: capabilityId, seq: seq, sampleTimeMs: sampleTimeMs, status: .outOfRange,
      valueCm: nil)
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySession.kt `AccessoryResponse`
enum AccessoryResponse: Equatable {
  case ack(requestId: Int, capabilityId: String, leaseMs: Int, applied: [String: String])
  case failed(requestId: Int?, code: String)
  case sample(AccessoryReading)
  case ignored
  case malformed

  static func parse(line: String, sessionId: String) -> AccessoryResponse {
    // intentional-suppression: a line that will not decode *is* `.malformed` — the failure is the
    guard let data = line.data(using: .utf8),
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return .malformed }
    guard root["sessionId"] as? String == sessionId else { return .ignored }

    switch root["type"] as? String {
    case "ack":
      guard let requestId = wholeNumber(root["requestId"]),
        let capabilityId = (root["capabilityId"] as? String), !capabilityId.isEmpty,
        let leaseMs = wholeNumber(root["leaseMs"]), leaseMs > 0
      else { return .ignored }
      var applied: [String: String] = [:]
      for (key, value) in (root["applied"] as? [String: Any]) ?? [:] {
        applied[key] = describe(value)
      }
      return .ack(
        requestId: requestId, capabilityId: capabilityId, leaseMs: leaseMs, applied: applied)

    case "error":
      guard let code = root["code"] as? String, !code.isEmpty else { return .ignored }
      return .failed(requestId: wholeNumber(root["requestId"]), code: code)

    case "reading":
      return parseReading(root)

    default:
      return .ignored
    }
  }

  private static func parseReading(_ root: [String: Any]) -> AccessoryResponse {
    guard let capabilityId = root["capabilityId"] as? String, !capabilityId.isEmpty,
      let seq = wholeNumber(root["seq"]), let sampleTimeMs = wholeNumber(root["sampleTimeMs"])
    else { return .ignored }
    let status = AccessoryReadingStatus.fromWire(root["status"] as? String)
    var value: Double?
    if let number = root["value"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
      number.doubleValue.isFinite
    {
      value = number.doubleValue
    }
    let resolved: AccessoryReadingStatus = (status == .ok && value == nil) ? .error : status
    return .sample(
      AccessoryReading(
        capabilityId: capabilityId, seq: seq, sampleTimeMs: Int64(sampleTimeMs), status: resolved,
        valueCm: resolved == .ok ? value : nil))
  }

  private static func describe(_ value: Any) -> String {
    if let text = value as? String { return text }
    if let number = value as? NSNumber {
      if CFGetTypeID(number) == CFBooleanGetTypeID() {
        return number.boolValue ? "true" : "false"
      }
      let asDouble = number.doubleValue
      if asDouble.isFinite, asDouble == asDouble.rounded(.down), abs(asDouble) < 1e15 {
        return String(Int64(asDouble))
      }
      return String(asDouble)
    }
    return "\(value)"
  }

  private static func wholeNumber(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, !(number is NSNull) else { return nil }
    let asDouble = number.doubleValue
    guard asDouble.isFinite, asDouble == asDouble.rounded(.down),
      asDouble >= Double(Int32.min), asDouble <= Double(Int32.max)
    else { return nil }
    return Int(asDouble)
  }
}
