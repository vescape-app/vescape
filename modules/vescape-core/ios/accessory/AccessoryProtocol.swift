import CoreBluetooth
import Foundation

/// Why a handshake produced no usable Accessory. Mirrors the `errors` list in
/// `shared/fixtures/accessory-protocol/handshake.json`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryProtocol.kt `AccessoryHandshakeError`
/// @parity /modules/vescape-core/src/index.ts `AccessoryInspectionError`
enum AccessoryHandshakeError: String {
  case malformed
  case invalid
  case sessionMismatch = "session-mismatch"
}

/// How much of a discovered Accessory this app can actually use.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryProtocol.kt `AccessoryCompatibility`
/// @parity /modules/vescape-core/src/index.ts `AccessoryCompatibility`
enum AccessoryCompatibility: String {
  case supported
  case unsupportedVersion = "unsupported-version"
  case unsupportedCapabilities = "unsupported-capabilities"
}

/// One capability an Accessory declares. `type` keeps the raw wire value even when unrecognized, so
/// an unknown capability can be named on screen instead of disappearing.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryProtocol.kt `AccessoryCapability`
/// @parity /modules/vescape-core/src/index.ts `AccessoryCapability`
struct AccessoryCapability: Equatable {
  let id: String
  let type: String
  let supported: Bool
  let unit: String?
  let rangeMin: Double?
  let rangeMax: Double?
  let ratesHz: [Double]

  func toMap() -> [String: Any?] {
    [
      "id": id,
      "type": type,
      "supported": supported,
      "unit": unit,
      "rangeMin": rangeMin,
      "rangeMax": rangeMax,
      "ratesHz": ratesHz,
    ]
  }
}

/// What an Accessory says about itself on every connection. Read again on each reconnect — saved
/// settings are only trusted after the identity, version and capability limits here still match.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryProtocol.kt `AccessoryManifest`
/// @parity /modules/vescape-core/src/index.ts `AccessoryManifest`
struct AccessoryManifest: Equatable {
  /// Factory-provisioned persistent UUID. Saved settings key on this, never on the BLE address.
  let accessoryId: String
  let name: String
  let firmwareVersion: String
  /// Nil when the accessory found no common version; it then accepts no operational commands.
  let protocolVersion: Int?
  /// What the accessory offers instead, present only when no version was agreed.
  let supportedVersions: [Int]
  let compatibility: AccessoryCompatibility
  let capabilities: [AccessoryCapability]

  func toMap() -> [String: Any?] {
    [
      "accessoryId": accessoryId,
      "name": name,
      "firmwareVersion": firmwareVersion,
      "protocolVersion": protocolVersion,
      "supportedVersions": supportedVersions,
      "compatibility": compatibility.rawValue,
      "capabilities": capabilities.map { $0.toMap() },
    ]
  }
}

enum ManifestResult: Equatable {
  case ok(AccessoryManifest)
  case failed(AccessoryHandshakeError)
}

/// Vescape Accessory Protocol v1 — the discovery half: the custom GATT service that identifies an
/// Accessory regardless of its advertised name, the `hello` the app writes once it has subscribed,
/// and the manifest it reads back.
///
/// Nothing here commands an Accessory. Discovery reads identity, protocol version and capability
/// types; every operational message (`configure`, `state`, `reading`) belongs to the per-capability
/// slices that follow, so an Accessory found here can never start measuring or lighting up.
///
/// The wire contract is `docs/accessory-protocol.md`; the executable form of it is
/// `shared/fixtures/accessory-protocol/`, which this file, its Kotlin peer and the ESP32 firmware
/// all run.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryProtocol.kt
/// @parity /modules/vescape-core/src/index.ts `AccessoryManifest`
enum AccessoryProtocol {
  /// Advertised service that makes a device a Vescape Accessory. Project-assigned, not SIG.
  static let serviceUUID = CBUUID(string: "8D53DC10-1DB7-4CD3-868B-8A527460AA84")
  /// App to accessory, write with response.
  static let writeUUID = CBUUID(string: "8D53DC11-1DB7-4CD3-868B-8A527460AA84")
  /// Accessory to app, notify.
  static let notifyUUID = CBUUID(string: "8D53DC12-1DB7-4CD3-868B-8A527460AA84")

  /// Maximum NDJSON line length excluding the LF. Anything longer ends the protocol session.
  static let maxLineBytes = 4096

  /// Protocol versions this app can speak.
  static let supportedVersions = [1]

  /// The handshake is the first request of a session, so its id is fixed.
  static let helloRequestId = 1

  /// Manifest response timeout, `docs/accessory-protocol.md` PoC defaults.
  static let handshakeTimeoutMs = 3_000

  /// Capability types v1 recognizes. An accessory may advertise others; they are reported as
  /// unsupported rather than hiding the capabilities that do work.
  ///
  /// @parity /modules/vescape-core/src/index.ts `AccessoryCapabilityType`
  static let typeGroundClearance = "ground_clearance"
  static let typeBrakeLight = "brake_light"

  /// Ground clearance is measured in centimetres; any other unit is a capability we cannot use.
  static let groundClearanceUnit = "cm"

  /// The one line discovery writes. Built by hand rather than through `JSONSerialization` because
  /// the shared fixture pins the exact bytes, and a dictionary encoder does not promise key order.
  static func encodeHello(sessionId: String) -> String {
    let versions = supportedVersions.map(String.init).joined(separator: ",")
    return "{\"type\":\"hello\",\"requestId\":\(helloRequestId),\"sessionId\":\(quote(sessionId)),"
      + "\"supportedVersions\":[\(versions)]}"
  }

  private static func quote(_ value: String) -> String {
    var out = "\""
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      default:
        if scalar.value < 0x20 {
          out += String(format: "\\u%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    return out + "\""
  }

  /// Decodes one received line as the manifest answering `sessionId`/`requestId`.
  ///
  /// Rejection is deliberately coarse: a manifest that fails any envelope rule is not partially
  /// trusted, because saved settings key on the identity it carries.
  static func parseManifest(
    line: String,
    sessionId: String,
    requestId: Int = helloRequestId
  ) -> ManifestResult {
    // intentional-suppression: malformed JSON is an expected input on this link, reported as
    // `.malformed` so the caller ends the protocol session
    guard let data = line.data(using: .utf8),
      let root = try? JSONSerialization.jsonObject(with: data),
      let object = root as? [String: Any]
    else { return .failed(.malformed) }

    // Session identity is checked before anything else is read: a message from a previous session
    // must not renew or influence this one.
    guard object["sessionId"] as? String == sessionId,
      integer(object["requestId"]) == requestId
    else { return .failed(.sessionMismatch) }
    guard object["type"] as? String == "manifest" else { return .failed(.invalid) }
    guard object.keys.contains("protocolVersion") else { return .failed(.invalid) }

    guard let accessoryId = requiredString(object["accessoryId"]),
      let name = requiredString(object["name"]),
      let firmwareVersion = requiredString(object["firmwareVersion"])
    else { return .failed(.invalid) }

    var protocolVersion: Int?
    if object["protocolVersion"] is NSNull {
      protocolVersion = nil
    } else if let value = integer(object["protocolVersion"]) {
      protocolVersion = value
    } else {
      return .failed(.invalid)
    }
    let versionAgreed = protocolVersion.map { supportedVersions.contains($0) } ?? false

    var offeredVersions: [Int] = []
    if let raw = object["supportedVersions"], !(raw is NSNull) {
      guard let array = raw as? [Any] else { return .failed(.invalid) }
      for entry in array {
        guard let value = integer(entry) else { return .failed(.invalid) }
        offeredVersions.append(value)
      }
    }

    var declared: [Any] = []
    if let raw = object["capabilities"], !(raw is NSNull) {
      guard let array = raw as? [Any] else { return .failed(.invalid) }
      declared = array
    }

    var capabilities: [AccessoryCapability] = []
    var seen = Set<String>()
    for entry in declared {
      guard let map = entry as? [String: Any],
        let capability = parseCapability(map, versionAgreed: versionAgreed),
        seen.insert(capability.id).inserted
      else { return .failed(.invalid) }
      capabilities.append(capability)
    }

    let compatibility: AccessoryCompatibility
    if !versionAgreed {
      compatibility = .unsupportedVersion
    } else if !capabilities.contains(where: { $0.supported }) {
      compatibility = .unsupportedCapabilities
    } else {
      compatibility = .supported
    }

    return .ok(
      AccessoryManifest(
        accessoryId: accessoryId,
        name: name,
        firmwareVersion: firmwareVersion,
        protocolVersion: protocolVersion,
        supportedVersions: offeredVersions,
        compatibility: compatibility,
        capabilities: capabilities
      )
    )
  }

  /// Nil means the capability breaks an envelope rule and the whole manifest is rejected.
  private static func parseCapability(
    _ entry: [String: Any],
    versionAgreed: Bool
  ) -> AccessoryCapability? {
    guard let id = requiredString(entry["id"]), let type = requiredString(entry["type"]) else {
      return nil
    }
    let unit = (entry["unit"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    var range: [String: Any]?
    if let raw = entry["range"], !(raw is NSNull) {
      guard let object = raw as? [String: Any] else { return nil }
      range = object
    }
    let rangeMin = double(range?["min"])
    let rangeMax = double(range?["max"])

    var ratesHz: [Double] = []
    if let raw = entry["ratesHz"], !(raw is NSNull) {
      guard let array = raw as? [Any] else { return nil }
      for value in array {
        guard let rate = double(value) else { return nil }
        ratesHz.append(rate)
      }
    }

    return AccessoryCapability(
      id: id,
      type: type,
      // A capability is only usable when the session speaks a version both sides agreed on, so a
      // version mismatch grays out every capability rather than some of them.
      supported: versionAgreed
        && typeUsable(type, unit: unit, rangeMin: rangeMin, rangeMax: rangeMax, ratesHz: ratesHz),
      unit: unit,
      rangeMin: rangeMin,
      rangeMax: rangeMax,
      ratesHz: ratesHz
    )
  }

  /// Whether a recognized capability type also declares limits this app can work within. A
  /// `ground_clearance` in millimetres, with an empty range, or offering no rate is a capability we
  /// would have to guess about; a recognized type is not by itself a usable one.
  private static func typeUsable(
    _ type: String,
    unit: String?,
    rangeMin: Double?,
    rangeMax: Double?,
    ratesHz: [Double]
  ) -> Bool {
    switch type {
    case typeBrakeLight:
      return true
    case typeGroundClearance:
      guard unit == groundClearanceUnit, let min = rangeMin, let max = rangeMax else { return false }
      return min.isFinite && max.isFinite && min < max
        && !ratesHz.isEmpty && ratesHz.allSatisfy { $0.isFinite && $0 > 0 }
    default:
      return false
    }
  }

  private static func requiredString(_ value: Any?) -> String? {
    guard let text = value as? String, !text.trimmingCharacters(in: .whitespaces).isEmpty else {
      return nil
    }
    return text
  }

  /// JSON numbers arrive as `NSNumber`; `true`/`false` arrive as one too. Identity is checked
  /// against `CFBoolean` rather than `as? Bool`, which happily converts the number 1.
  private static func isBoolean(_ value: Any?) -> Bool {
    guard let number = value as? NSNumber else { return false }
    return CFGetTypeID(number) == CFBooleanGetTypeID()
  }

  /// A JSON number that is genuinely a whole number.
  ///
  /// `intValue` truncates, which would let `protocolVersion: 1.9` pass as the v1 this app speaks.
  /// A version or request id is an integer or it is nothing.
  private static func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, !isBoolean(value) else { return nil }
    let asDouble = number.doubleValue
    guard asDouble.isFinite, asDouble == asDouble.rounded(.down),
      asDouble >= Double(Int32.min), asDouble <= Double(Int32.max)
    else { return nil }
    return number.intValue
  }

  private static func double(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber, !isBoolean(value) else { return nil }
    return number.doubleValue
  }
}
