import Foundation

/// Vescape Accessory Protocol v1 — the operational half: the commands an enrolled Accessory's
/// session sends, and the acknowledgements it accepts back.
///
/// Pure and transport-free on purpose. `AccessoryLink` owns the radio and the clock; everything
/// here is bytes in, bytes out, so the request-id discipline and the encodings can be asserted
/// against `shared/fixtures/accessory-protocol/session.json` without a peripheral in the room.
///
/// Two rules this file exists to keep:
///
/// - **Commands set desired values.** Nothing toggles or cycles, so resending the same command is
///   always safe and a dropped ack costs a retry rather than a restarted animation.
/// - **Request ids are strictly increasing within a session, and never reused with a different
///   body.** A new protocol session restarts them, which is what makes an old queue harmless.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySession.kt
/// @parity /modules/vescape-core/src/index.ts `AccessoryCapabilitySettings`
enum AccessorySession {
  /// How long an accessory holds a command before falling back to its local behavior.
  static let leaseMs: Int = 2_000

  /// How often the app re-sends the current desired command to hold the lease open.
  static let renewIntervalMs: Int = 500

  /// How long one request waits for its ack. The first timeout retries with the *same* id — a
  /// retry must not look like a new command — and the second gives up on the accessory.
  static let requestTimeoutMs: Int = 500

  /// The handshake owns request id 1, so operational requests start after it.
  static let firstCommandRequestId = AccessoryProtocol.helloRequestId + 1

  /// Nearest supported rate, lower on a tie.
  ///
  /// The accessory resolves this too and answers with what it actually applied; the app resolves
  /// it first only so the request it sends is one the hardware can accept. An empty rate list
  /// means the capability declared none, and a capability with no rate is not configurable.
  static func resolveRateHz(requested: Double, ratesHz: [Double]) -> Double? {
    let usable = ratesHz.filter { $0.isFinite && $0 > 0 }.sorted()
    guard let first = usable.first else { return nil }
    // `<` and not `<=`: equal distance keeps the earlier-sorted, i.e. lower, rate.
    return usable.dropFirst().reduce(first) { best, candidate in
      abs(candidate - requested) < abs(best - requested) ? candidate : best
    }
  }
}

/// One desired capability state. Complete by construction: every field the accessory needs is
/// carried on every send, so a renewal is a replay and never a partial update.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySession.kt `AccessoryCommand`
/// @parity /modules/vescape-core/src/index.ts `AccessoryCommandSnapshot`
enum AccessoryCommand: Equatable {
  /// Measurement demand for a `ground_clearance` capability.
  case configure(capabilityId: String, enabled: Bool, rateHz: Double)
  /// Semantic output state for a `brake_light` capability. `telemetry` says whether Board data is
  /// reaching the app at all; `mode` is nil when it is not, outside preview.
  case state(
    capabilityId: String, telemetry: String, mode: String?, parked: String, preview: Bool)

  var capabilityId: String {
    switch self {
    case .configure(let id, _, _): return id
    case .state(let id, _, _, _, _): return id
    }
  }

  /// The exact line to write, at `requestId`, inside `sessionId`.
  ///
  /// Built by hand rather than through `JSONSerialization` for the same reason `encodeHello` is:
  /// the shared fixture compares bytes, and a dictionary encoder does not promise key order.
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
      // Omitted when false: the protocol's default, and an omitted field keeps older accessories
      // reading exactly the state they read before preview existed.
      if preview { out += ",\"preview\":true" }
      return out + "}"
    }
  }

  private func quote(_ value: String) -> String { AccessoryProtocol.quote(value) }

  /// Whole rates print without a decimal point, matching every other encoder on this link.
  private func number(_ value: Double) -> String {
    if value.isFinite, value == value.rounded(.down), abs(value) < 1e15 {
      return String(Int64(value))
    }
    return String(value)
  }
}

/// What a sample says about itself. The status is carried, never inferred.
///
/// There is no fourth case and no "unknown": a line this app cannot read as a measurement resolves
/// to `error`, because the alternative — quietly treating it as the far end of the range — is a
/// board told it has all the clearance in the world at the exact moment its sensor stopped working.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySession.kt `AccessoryReadingStatus`
/// @parity /modules/vescape-core/src/index.ts `AccessoryReadingStatus`
enum AccessoryReadingStatus: String {
  /// A real measurement. The only status that carries a value.
  case ok
  /// The sensor answered, and the answer is not a distance this capability promises.
  case outOfRange = "out_of_range"
  /// The sensor could not measure, or the app could not read what it sent.
  case error

  /// Whatever a line claimed, as a status this app can act on.
  ///
  /// A status string from the future is `error` rather than a guess. It cannot be `ok` — that would
  /// invent a measurement — and it cannot be `outOfRange` either, which would claim the sensor
  /// answered when nobody here knows that it did.
  static func fromWire(_ value: String?) -> AccessoryReadingStatus {
    guard let value, let known = AccessoryReadingStatus(rawValue: value) else { return .error }
    return known
  }
}

/// One sample from a measurement capability.
///
/// `valueCm` exists **only** when `status` is `.ok`; the initialiser enforces it, so there is no way
/// to hold a reading whose status and value disagree. That invariant is the whole safety property of
/// this slice: a consumer that has a value has a measurement.
///
/// `sampleTimeMs` is the accessory's own monotonic clock since its session began, never comparable
/// to a phone timestamp. Freshness is judged on local receipt time; this field only orders samples.
///
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
    // Not a precondition that crashes a background BLE callback: the impossible pairing is resolved
    // the only safe way there is, by dropping the value rather than the status.
    self.valueCm = status == .ok ? valueCm : nil
  }

  /// The same sample judged against the limits the capability declared.
  ///
  /// A number outside the declared window is reported as out of range rather than clamped into it.
  /// Clamping is how a sensor staring at nothing ends up reporting the maximum distance, which is
  /// exactly the reading that would tell the board it is safe to tilt.
  func withinDeclaredRange(rangeMin: Double?, rangeMax: Double?) -> AccessoryReading {
    guard let value = valueCm, let rangeMin, let rangeMax else { return self }
    guard value < rangeMin || value > rangeMax else { return self }
    return AccessoryReading(
      capabilityId: capabilityId, seq: seq, sampleTimeMs: sampleTimeMs, status: .outOfRange,
      valueCm: nil)
  }
}

/// What one received line means to a live session.
///
/// `ignored` is deliberately distinct from `malformed`: a line for another session, or of a type
/// this slice does not handle, is ordinary traffic on a shared characteristic. Only something the
/// framer or the JSON parser could not make sense of ends the session.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessorySession.kt `AccessoryResponse`
enum AccessoryResponse: Equatable {
  /// A command was validated and applied, and the accessory will hold it for `leaseMs`.
  case ack(requestId: Int, capabilityId: String, leaseMs: Int, applied: [String: String])
  /// The accessory refused a request. Nothing partial was applied.
  case failed(requestId: Int?, code: String)
  /// One sample off the unacknowledged reading stream. Answers nothing and renews no lease.
  case sample(AccessoryReading)
  case ignored
  case malformed

  /// Decodes one received line against `sessionId`.
  ///
  /// Session identity is checked first and an ack missing its lease is refused: without a lease
  /// the app has no idea how long the accessory will hold what it just applied, and guessing one
  /// is how a light ends up dark with the app believing otherwise.
  static func parse(line: String, sessionId: String) -> AccessoryResponse {
    // intentional-suppression: a line that will not decode *is* `.malformed` — the failure is the
    // return value, and the caller ends the protocol session on it.
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
      // Flattened to strings: the app compares what was applied against what it asked for, and a
      // textual comparison is the same on both platforms where `1` and `true` are not.
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

  /// One sample, or `.ignored` when the envelope is not one.
  ///
  /// The envelope fields — capability, sequence, sample time — must all be there, because without
  /// them a sample cannot be ordered against its neighbours and an unorderable sample is not
  /// evidence of anything. The *status* is the opposite: whatever it says, this returns a reading,
  /// because "the sensor sent something this app cannot read" is itself information the consumer
  /// needs, and dropping it would leave the last good sample standing.
  private static func parseReading(_ root: [String: Any]) -> AccessoryResponse {
    guard let capabilityId = root["capabilityId"] as? String, !capabilityId.isEmpty,
      let seq = wholeNumber(root["seq"]), let sampleTimeMs = wholeNumber(root["sampleTimeMs"])
    else { return .ignored }
    let status = AccessoryReadingStatus.fromWire(root["status"] as? String)
    // An `ok` is only an `ok` once it produced a finite number. A missing, null or non-numeric
    // value demotes the sample to `error` — never to the top of the range. `as? NSNumber` also
    // excludes strings, which is what makes `"value":"12.4"` an error rather than a distance.
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
      // `as? Bool` is not the test: `NSNumber(1)` bridges to `true`, so a `rateHz` of 1 would be
      // described as a boolean. Only a genuine `CFBoolean` is one.
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
