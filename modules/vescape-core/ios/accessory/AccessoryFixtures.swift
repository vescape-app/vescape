import Foundation

/// The shared Accessory Protocol corpus, located relative to this file the way the Refloat schema
/// fixtures are. The same files drive the Kotlin peer and the ESP32 firmware's native tests, so a
/// contract that drifts on one side fails on all three.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/accessory/AccessoryFixtures.kt
enum AccessoryFixtures {
  static func load(_ name: String) throws -> [String: Any] {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // accessory
      .deletingLastPathComponent()  // ios
      .deletingLastPathComponent()  // vescape-core
      .deletingLastPathComponent()  // modules
      .deletingLastPathComponent()  // repo root
    let data = try Data(
      contentsOf: root.appendingPathComponent("shared/fixtures/accessory-protocol/\(name)")
    )
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw NSError(
        domain: "AccessoryFixtures", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "\(name) is not a JSON object"]
      )
    }
    return object
  }

  static func hexToBytes(_ hex: String) -> [UInt8] {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      bytes.append(UInt8(hex[index..<next], radix: 16) ?? 0)
      index = next
    }
    return bytes
  }
}
